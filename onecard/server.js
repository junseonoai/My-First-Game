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
const LATE_PRESS_MS = 2500; // 승부가 난 뒤에도 이 시간 안에 누르면 반응 속도만 기록
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
      deadline: room.deadline || null,
      race: raceView(room),
    });
  }
}

function scheduleTurn(room) {
  clearTimeout(room.turnTimer);
  clearTimeout(room.botTimer);
  room.deadline = null;
  const g = room.game;
  if (!g || g.finished) return;

  scheduleOneCard(room);

  const cur = g.cur();
  room.lastTurnId = room.curTurnId;
  room.curTurnId = cur.id;
  const member = room.members.find((m) => m.id === cur.id);
  if (member && member.bot) {
    room.botTimer = setTimeout(() => {
      if (room.game === g && !g.finished && g.cur().id === cur.id) {
        g.botMove(cur.id, member.tier);
        after(room);
      }
    }, (room.lastTurnId === cur.id ? 1800 : 900) + Math.random() * 900); // 같은 봇이 연달아 내면 조금 더 천천히
  } else {
    room.deadline = Date.now() + TURN_SECONDS * 1000;
    room.turnTimer = setTimeout(() => {
      if (room.game === g && !g.finished && g.cur().id === cur.id) {
        g.addLog(`${cur.name}님 시간 초과`);
        g.draw(cur.id);
        after(room);
      }
    }, TURN_SECONDS * 1000);
  }
}

// --- 원카드 버튼 경쟁: 누가 몇 초 만에 눌렀는지 기록 ---
// race = { id, target, since, presses: [{ id, ms, first }], doneAt }
function raceView(room) {
  const r = room.race;
  if (!r || !r.presses.length) return null;
  const name = (id) => (room.members.find((m) => m.id === id) || {}).name || '?';
  return {
    id: r.id,
    target: r.target,
    targetName: name(r.target),
    presses: r.presses.map((p) => ({ ...p, name: name(p.id) })),
  };
}

// 원카드 버튼 누름 (사람·봇 공통). 이겼으면 true
function pressOneCard(room, id) {
  const g = room.game;
  const r = room.race;
  if (!g || !r) return false;
  const now = Date.now();
  if (r.presses.some((p) => p.id === id)) return false;
  if (g.oneCard && g.oneCard.playerId === r.target && !r.doneAt) {
    const res = g.callOneCard(id);
    if (!res.ok) return false;
    r.presses.push({ id, ms: now - r.since, first: true });
    r.doneAt = now;
    return true;
  }
  // 이미 누가 먼저 눌렀다: 늦게 누른 기록만 남긴다
  if (r.doneAt && now - r.doneAt < LATE_PRESS_MS) {
    r.presses.push({ id, ms: now - r.since, first: false });
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
  const race = { id: (room.race ? room.race.id : 0) + 1, target: targetId, since: Date.now(), presses: [], doneAt: 0 };
  room.race = race;
  const fire = (callerId) => {
    if (room.game !== g || room.race !== race) return;
    if (pressOneCard(room, callerId)) after(room);
  };
  const between = ([a, b]) => a + Math.random() * (b - a);
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
    room.game = new Game(room.members.map((m) => ({ id: m.id, name: m.name, bot: m.bot, tier: m.tier })));
    after(room);
  });

  socket.on('play', ({ cardId, cardIds, suit } = {}) => {
    if (!room || !room.game) return;
    const ids = Array.isArray(cardIds) ? cardIds.slice(0, 4) : cardId;
    const res = room.game.play(memberId, ids, suit);
    if (!res.ok) return fail(res.error);
    after(room);
  });

  socket.on('draw', () => {
    if (!room || !room.game) return;
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
