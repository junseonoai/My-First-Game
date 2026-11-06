const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Game } = require('./game');
const { TIERS, REACTION } = require('./bots');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const TURN_SECONDS = 30;
const RECONNECT_GRACE_MS = 60_000;
const ONECARD_COUNTDOWN_MS = 3000; // 원카드 버튼은 3초 카운트다운 뒤에 열린다
const LATE_PRESS_MS = 2500;
const NO_PRESS_MS = 5000; // 버튼이 열리고 이 시간 안에 아무도 안 누르면 경쟁 끝 (게임이 멈추지 않게)
const RESULT_PAUSE_MS = 2500; // 결과를 보는 동안 판을 잠깐 멈춘다 // 승부가 난 뒤에도 이 시간 안에 누르면 반응 속도만 기록
const EMOJIS = ['😀', '😂', '😎', '😭', '😡', '😱', '👍', '👏', '🔥', '💀'];
const PHRASES = ['빨리 내요!', '잘했어요', '아 안 돼!', '봐주세요', '원카드 조심!', '공격 간다!', '운이 좋네요', '한 판 더?', 'ㅋㅋㅋㅋ', '안녕하세요'];
const BOT_NAMES = ['철수', '영희', '민수', '지수', '하늘'];

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

// code -> room
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(n) {
  return String(n || '').trim().slice(0, 12) || '익명';
}

function lobbyState(room) {
  return {
    code: room.code,
    host: room.host,
    members: room.members.map((m) => ({ id: m.id, name: m.name, bot: m.bot, tier: m.tier, online: m.bot || !!m.socketId })),
    playing: !!room.game && !room.game.finished,
  };
}

function broadcast(room) {
  const lobby = lobbyState(room);
  for (const m of room.members) {
    if (m.bot || !m.socketId) continue;
    io.to(m.socketId).emit('state', {
      lobby,
      me: m.id,
      game: room.game ? room.game.view(m.id) : null,
      turnLeft: room.deadline ? Math.max(0, room.deadline - Date.now()) : null, // 남은 시간 (기기 시계와 무관)
      race: raceView(room),
    });
  }
}

// 원카드 창이 화면을 가리는 동안(카운트다운 + 결과) 사람의 시간은 깎지 않는다
const RACE_COVER_MS = NO_PRESS_MS + RESULT_PAUSE_MS;
function raceCoverLeft(room) {
  const r = room.race;
  if (!r || r.doneAt) return 0;
  return Math.max(0, r.openAt - Date.now()) + RACE_COVER_MS;
}

// 원카드 경쟁 중이면 판을 멈춘다: 남은 멈춤 시간 (모르면 짧게 다시 확인)
function pausedFor(room) {
  const r = room.race;
  if (!r) return 0;
  if (!r.doneAt) return 300;
  return Math.max(0, r.doneAt + RESULT_PAUSE_MS - Date.now());
}
// 멈춤이 끝난 뒤에 fn 실행
function whenUnpaused(room, fn, timerKey) {
  const wait = pausedFor(room);
  if (wait > 0) { room[timerKey] = setTimeout(() => whenUnpaused(room, fn, timerKey), wait); return; }
  fn();
}

function scheduleTurn(room) {
  const g = room.game;
  if (!g || g.finished) {
    clearTimeout(room.turnTimer); clearTimeout(room.botTimer);
    room.deadline = null; room.turnKey = null;
    return;
  }
  const hadRace = room.race;
  scheduleOneCard(room);
  const cur = g.cur();
  // 같은 차례가 이어지는 중이면(원카드 누름 등) 타이머를 처음부터 다시 시작하지 않는다
  const key = `${g.moves || 0}:${cur.id}`;
  if (key === room.turnKey) {
    // 이 차례 도중에 원카드 경쟁이 새로 시작됐다면 그만큼 시간을 더 준다
    if (room.race !== hadRace && room.deadline) extendTurn(room, raceCoverLeft(room));
    return;
  }
  room.turnKey = key;
  clearTimeout(room.turnTimer);
  clearTimeout(room.botTimer);
  room.deadline = null;
  room.lastTurnId = room.curTurnId;
  room.curTurnId = cur.id;
  const member = room.members.find((m) => m.id === cur.id);
  if (member && member.bot) {
    room.botTimer = setTimeout(() => whenUnpaused(room, () => {
      if (room.game === g && !g.finished && g.cur().id === cur.id) {
        g.botMove(cur.id, member.tier);
        after(room);
      }
    }, 'botTimer'), (room.lastTurnId === cur.id ? 1800 : 900) + Math.random() * 900); // 같은 봇이 연달아 내면 조금 더 천천히
  } else {
    room.deadline = Date.now();
    extendTurn(room, TURN_SECONDS * 1000 + raceCoverLeft(room));
  }
}

function extendTurn(room, ms) {
  const g = room.game;
  const cur = g.cur();
  room.deadline += ms;
  clearTimeout(room.turnTimer);
  room.turnTimer = setTimeout(() => whenUnpaused(room, () => {
    if (room.game === g && !g.finished && g.cur().id === cur.id) {
      g.addLog(`${cur.name}님 시간 초과`);
      g.draw(cur.id);
      after(room);
    }
  }, 'turnTimer'), room.deadline - Date.now());
}

// --- 원카드 버튼 경쟁: 누가 몇 초 만에 눌렀는지 기록 ---
// race = { id, target, since, presses: [{ id, ms, first }], doneAt }
function raceView(room) {
  const r = room.race;
  if (!r) return null;
  const name = (id) => (room.members.find((m) => m.id === id) || {}).name || '?';
  return {
    id: r.id,
    target: r.target,
    targetName: name(r.target),
    openIn: Math.max(0, r.openAt - Date.now()), // 버튼이 열리기까지 남은 시간 (기기 시계 차이 없이)
    done: !!r.doneAt,
    presses: r.presses.map((p) => ({ ...p, name: name(p.id) })),
  };
}

// 원카드 버튼 누름 (사람·봇 공통). 이겼으면 true
function pressOneCard(room, id) {
  const g = room.game;
  const r = room.race;
  if (!g || !r) return false;
  const now = Date.now();
  if (now < r.openAt) return false; // 카운트다운 중에는 누를 수 없다
  if (r.presses.some((p) => p.id === id)) return false;
  if (g.oneCard && g.oneCard.playerId === r.target && !r.doneAt) {
    const res = g.callOneCard(id);
    if (!res.ok) return false;
    r.presses.push({ id, ms: now - r.openAt, first: true });
    r.doneAt = now;
    return true;
  }
  // 이미 누가 먼저 눌렀다: 늦게 누른 기록만 남긴다
  if (r.doneAt && now - r.doneAt < LATE_PRESS_MS) {
    r.presses.push({ id, ms: now - r.openAt, first: false });
    broadcast(room);
  }
  return false;
}

// 봇의 원카드 외치기/잡기: 단계마다 반응 속도와 정확도가 다르다 (대상이 바뀔 때만 새 경쟁)
function scheduleOneCard(room) {
  const g = room.game;
  const targetId = g && !g.finished && g.oneCard ? g.oneCard.playerId : null;
  if (targetId === room.oneCardFor) return;
  room.oneCardFor = targetId;
  if (!targetId) return; // 승부가 나도 남은 봇 타이머는 늦은 기록용으로 둔다
  (room.oneCardTimers || []).forEach(clearTimeout);
  room.oneCardTimers = [];
  const race = { id: (room.race ? room.race.id : 0) + 1, target: targetId, openAt: Date.now() + ONECARD_COUNTDOWN_MS, presses: [], doneAt: 0, moves: g.moves };
  room.race = race;
  room.oneCardTimers.push(setTimeout(() => {
    if (room.game !== g || room.race !== race || race.doneAt) return;
    race.doneAt = Date.now();
    if (g.oneCard && g.oneCard.playerId === race.target) g.oneCard = null; // 아무도 안 눌렀으니 벌칙 없음
    after(room);
  }, ONECARD_COUNTDOWN_MS + NO_PRESS_MS));
  const fire = (callerId) => {
    if (room.game !== g || room.race !== race) return;
    if (pressOneCard(room, callerId)) after(room);
  };
  const between = ([a, b]) => ONECARD_COUNTDOWN_MS + a + Math.random() * (b - a); // 버튼이 열린 뒤부터 반응
  for (const m of room.members) {
    if (!m.bot) continue;
    const pl = g.find(m.id);
    if (!pl || (pl.out && m.id !== targetId)) continue;
    const r = REACTION[m.tier] || REACTION.gold;
    // 자기 원카드는 외치고, 남의 원카드는 잡는다. 가장 먼저 누른 사람이 이긴다
    if (m.id === targetId) { if (Math.random() < r.self) room.oneCardTimers.push(setTimeout(() => fire(m.id), between(r.selfMs))); }
    else if (Math.random() < r.catch) room.oneCardTimers.push(setTimeout(() => fire(m.id), between(r.catchMs)));
  }
}

function after(room) {
  scheduleTurn(room);
  broadcast(room);
  if (process.env.ONECARD_CHECK) checkInvariants(room);
}

// 개발용 점검 (ONECARD_CHECK=1): 카드 수, 차례, 원카드 중 멈춤
function checkInvariants(room) {
  const g = room.game;
  if (!g) return;
  const ids = [...g.deck, ...g.discard, ...g.players.flatMap((p) => p.hand)].map((c) => c.id);
  const bad = [];
  if (ids.length !== 54) bad.push(`카드 수 ${ids.length}`);
  if (new Set(ids).size !== ids.length) bad.push('같은 카드가 두 장');
  if (!g.finished && g.cur().out) bad.push('나간 사람 차례');
  const r = room.race;
  if (r) {
    if (r.moves === undefined) r.moves = g.moves;
    if ((!r.doneAt || Date.now() < r.doneAt + RESULT_PAUSE_MS - 50) && g.moves !== r.moves && !g.finished) bad.push(`원카드 중에 수를 둠 (${r.moves}→${g.moves})`);
  }
  if (bad.length) console.error('INVARIANT', room.code, bad.join(', '));
}

function leaveRoom(room, memberId) {
  const idx = room.members.findIndex((m) => m.id === memberId);
  if (idx < 0) return;
  const [m] = room.members.splice(idx, 1);
  clearTimeout(m.graceTimer);
  if (room.game && !room.game.finished) room.game.removePlayer(memberId);
  const humans = room.members.filter((x) => !x.bot);
  if (humans.length === 0) {
    clearTimeout(room.turnTimer);
    clearTimeout(room.botTimer);
    (room.oneCardTimers || []).forEach(clearTimeout);
    rooms.delete(room.code);
    return;
  }
  if (room.host === memberId) room.host = humans[0].id;
  if (room.game) scheduleTurn(room);
  broadcast(room);
}

io.on('connection', (socket) => {
  let room = null;
  let memberId = null;

  const fail = (msg) => socket.emit('toast', msg);

  socket.on('create', ({ name, uid }) => {
    if (room) return;
    const code = makeCode();
    room = { code, host: uid, members: [], game: null };
    rooms.set(code, room);
    memberId = uid;
    room.members.push({ id: uid, name: cleanName(name), bot: false, socketId: socket.id });
    socket.join(code);
    broadcast(room);
  });

  socket.on('join', ({ name, uid, code }) => {
    if (room) return;
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return fail('방을 찾을 수 없어요. 코드를 확인하거나 방을 새로 만들어 주세요.');
    const existing = r.members.find((m) => m.id === uid);
    if (existing && existing.socketId && existing.socketId !== socket.id && io.sockets.sockets.has(existing.socketId)) {
      // 같은 ID가 다른 탭에서 아직 접속 중 → 새 ID로 다시 참가하게 함
      return socket.emit('uidTaken', { code: r.code });
    }
    if (existing) {
      // 재접속
      clearTimeout(existing.graceTimer);
      existing.socketId = socket.id;
    } else {
      if (r.game && !r.game.finished) return fail('이미 게임이 진행 중이에요.');
      if (r.members.length >= MAX_PLAYERS) return fail('방이 가득 찼어요. (최대 6명)');
      r.members.push({ id: uid, name: cleanName(name), bot: false, socketId: socket.id });
    }
    room = r;
    memberId = uid;
    socket.join(r.code);
    broadcast(r);
  });

  socket.on('addBot', (tier) => {
    if (!room || room.host !== memberId) return;
    if (room.game && !room.game.finished) return;
    if (room.members.length >= MAX_PLAYERS) return fail('방이 가득 찼어요.');
    const used = new Set(room.members.map((m) => m.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || '봇';
    room.members.push({ id: 'bot-' + Math.random().toString(36).slice(2, 9), name, bot: true, tier: TIERS.includes(tier) ? tier : 'gold' });
    broadcast(room);
  });

  socket.on('setBotTier', ({ id, tier } = {}) => {
    if (!room || room.host !== memberId || !TIERS.includes(tier)) return;
    if (room.game && !room.game.finished) return;
    const m = room.members.find((x) => x.id === id && x.bot);
    if (!m) return;
    m.tier = tier;
    broadcast(room);
  });

  socket.on('kick', (id) => {
    if (!room || room.host !== memberId || id === memberId) return;
    if (room.game && !room.game.finished) return;
    const m = room.members.find((x) => x.id === id);
    if (!m) return;
    if (m.socketId) io.to(m.socketId).emit('kicked');
    leaveRoom(room, id);
  });

  socket.on('start', () => {
    if (!room || room.host !== memberId) return;
    if (room.game && !room.game.finished) return;
    if (room.members.length < 2) return fail('2명 이상 있어야 시작할 수 있어요. 봇을 추가해 보세요!');
    room.oneCardFor = null;
    room.race = null;
    room.turnKey = null;
    room.game = new Game(room.members.map((m) => ({ id: m.id, name: m.name, bot: m.bot, tier: m.tier })));
    after(room);
  });

  socket.on('play', ({ cardId, cardIds, suit } = {}) => {
    if (!room || !room.game) return;
    if (pausedFor(room) > 0) return fail('원카드 확인 중이에요. 잠깐만요!');
    const ids = Array.isArray(cardIds) ? cardIds.slice(0, 4) : cardId;
    const res = room.game.play(memberId, ids, suit);
    if (!res.ok) return fail(res.error);
    after(room);
  });

  socket.on('draw', () => {
    if (!room || !room.game) return;
    if (pausedFor(room) > 0) return fail('원카드 확인 중이에요. 잠깐만요!');
    const res = room.game.draw(memberId);
    if (!res.ok) return fail(res.error);
    after(room);
  });

  socket.on('oneCard', () => {
    if (!room || !room.game) return;
    if (pressOneCard(room, memberId)) after(room);
  });

  socket.on('chat', (text) => {
    if (!room) return;
    const m = room.members.find((x) => x.id === memberId);
    const t = String(text || '').trim().slice(0, 100);
    if (!m || !t) return;
    io.to(room.code).emit('chat', { name: m.name, text: t });
  });

  let lastEmote = 0;
  socket.on('emote', (text) => {
    if (!room) return;
    const m = room.members.find((x) => x.id === memberId);
    if (!m) return;
    const kind = EMOJIS.includes(text) ? 'emoji' : PHRASES.includes(text) ? 'phrase' : null;
    if (!kind) return;
    const now = Date.now();
    if (now - lastEmote < 800) return;
    lastEmote = now;
    io.to(room.code).emit('emote', { id: m.id, name: m.name, text, kind });
  });

  socket.on('leave', () => {
    if (!room) return;
    const r = room;
    socket.leave(r.code);
    room = null;
    leaveRoom(r, memberId);
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const r = room;
    const m = r.members.find((x) => x.id === memberId);
    if (!m || m.socketId !== socket.id) return;
    m.socketId = null;
    if (r.game && !r.game.finished) {
      // 게임 중에는 잠시 기다렸다가 내보냄
      m.graceTimer = setTimeout(() => leaveRoom(r, m.id), RECONNECT_GRACE_MS);
      broadcast(r);
    } else {
      leaveRoom(r, m.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`원카드 서버 실행 중: http://localhost:${PORT}`);
});
