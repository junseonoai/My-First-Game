const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Game, honor } = require('./game');
const { TIERS, REACTION, chooseMove, wantSearch, searchIter } = require('./bots');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const TURN_SECONDS = 30;
const RECONNECT_GRACE_MS = 60_000;
const OFFLINE_TURN_MS = 4000; // 연결이 끊긴 사람 차례는 이만큼 뒤에 자동으로 넘어간다
const STUCK_MS = 15_000; // 판이 이 시간 넘게 이유 없이 멈춰 있으면 감시가 다시 움직인다
const ONECARD_COUNTDOWN_MS = 3000; // 원카드 버튼은 3초 카운트다운 뒤에 열린다
const ONECARD_WINDOW_MS = 2000; // 버튼이 열린 뒤 누를 수 있는 시간
const ONECARD_RESULT_MS = 1200; // 전체 결과를 보여 주는 시간. 끝나면 모두 동시에 판 재개
const INTRO_MS = 7600; // 게임 시작 연출: 먼저 할 사람 고르기(둘이면 칩 던지기, 셋 이상이면 룰렛) → 덱 → 카드 나눠 주기 → 시작 카드
const EMOJIS = ['😀', '😂', '😎', '😭', '😡', '😱', '👍', '👏', '🔥', '💀'];
const PHRASES = ['빨리 내요!', '잘했어요', '아 안 돼!', '봐주세요', '원카드 조심!', '공격 간다!', '운이 좋네요', '한 판 더?', 'ㅋㅋㅋㅋ', '안녕하세요'];
const BOT_NAMES = ['철수', '영희', '민수', '지수', '하늘'];

// 점검용 (ONECARD_LAG=1): 서버가 다른 일을 못 하고 멈춰 있던 최대 시간을 10초마다 찍는다
if (process.env.ONECARD_LAG) {
  const h = require('perf_hooks').monitorEventLoopDelay({ resolution: 5 }); h.enable();
  setInterval(() => { console.log(`LAG max ${(h.max / 1e6).toFixed(0)}ms p99 ${(h.percentile(99) / 1e6).toFixed(0)}ms`); h.reset(); }, 10000);
}

const app = express();
// 그림·글꼴은 휴대폰에 7일 동안 저장해 두고, 화면 코드(html·css·js)는 매번 바뀐 게 있는지만 확인한다
const LONG_CACHE = /\.(png|svg|woff2?|jpg|webp)$/i;
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => { if (LONG_CACHE.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800'); },
}));
const server = http.createServer(app);
// 연결 확인을 자주 해서 휴대폰 신호가 끊긴 사람을 빨리 알아챈다 (기본값은 최대 45초)
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

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

// 플레이어 ID: 브라우저가 만든 짧은 글자만 받는다
function validUid(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 64;
}

function cleanName(n) {
  if (typeof n !== 'string') return '익명';
  return n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12) || '익명';
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
      intro: introView(room),
    });
  }
}

// 먼저 할 사람 고르기 화면
function introView(room) {
  const it = room.intro;
  if (!it || Date.now() >= it.until) return null;
  return { id: it.id, kind: it.kind, order: it.order, starter: it.starter, left: it.until - Date.now() };
}
function introLeft(room) {
  return room.intro ? Math.max(0, room.intro.until - Date.now()) : 0;
}

// 원카드 창이 화면을 가리는 동안(카운트다운 + 누르기 + 결과) 사람의 시간은 깎지 않는다
function raceCoverLeft(room) {
  const r = room.race;
  if (!r) return 0;
  if (r.doneAt) return Math.max(0, r.doneAt + ONECARD_RESULT_MS - Date.now());
  return Math.max(0, r.openAt - Date.now()) + ONECARD_WINDOW_MS + ONECARD_RESULT_MS;
}

// 원카드 경쟁 중이거나 시작 화면이면 판을 멈춘다: 남은 멈춤 시간 (모르면 짧게 다시 확인)
function pausedFor(room) {
  const intro = introLeft(room);
  if (intro > 0) return intro + 20;
  const r = room.race;
  if (!r) return 0;
  if (!r.doneAt) return Math.max(50, r.closeAt - Date.now() + 50);
  return Math.max(0, r.doneAt + ONECARD_RESULT_MS - Date.now()); // 결과를 잠깐 보여 준 뒤 다 함께 재개
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
    // 둘만 남은 막판에는 기다리는 동안 모의 게임으로 미리 고민해 둔다 (잘게 나눠 계산해서 다른 일을 막지 않음)
    const job = startThinking(room, g, cur.id, member.tier, key);
    room.botTimer = setTimeout(() => whenUnpaused(room, function act() {
      if (room.game === g && !g.finished && g.cur().id === cur.id) {
        if (job && !job.done && room.turnKey === key) { job.onDone = () => whenUnpaused(room, act, 'botTimer'); return; } // 아직 고민 중
        const before = { penalty: g.penalty, count: cur.hand.length, rank: cur.rank };
        playBot(room, g, cur.id, member.tier, job && job.done && room.turnKey === key && job.moves === g.moves ? job.move : null);
        after(room);
        // 봇 반응: 크게 먹으면 아쉬워하고, 큰 공격을 넣으면 신나 하고, 이기면 뽐낸다
        if (cur.rank === 1 && !before.rank) botEmote(room, member, 'win');
        else if (cur.hand.length > before.count && before.penalty >= 5) botEmote(room, member, 'hurt');
        else if (g.penalty >= 7 && g.penalty > before.penalty) botEmote(room, member, 'attack');
      }
    }, 'botTimer'), (room.lastTurnId === cur.id ? 1800 : 900) + Math.random() * 900); // 같은 봇이 연달아 내면 조금 더 천천히
  } else {
    room.deadline = Date.now();
    // 연결이 끊긴 사람은 모두를 30초씩 기다리게 하지 않는다 (몇 초 뒤 자동으로 뽑기)
    const away = member && !member.socketId;
    extendTurn(room, (away ? OFFLINE_TURN_MS : TURN_SECONDS * 1000) + raceCoverLeft(room) + introLeft(room));
  }
}

// 봇의 다른 사람 등급 추정 (공개 정보). 사람은 골드쯤으로 본다
function tierOfIn(room) {
  return (id) => { const m = room.members.find((x) => x.id === id); return (m && m.bot && m.tier) || 'gold'; };
}
// 모의 게임 고민: 조각(약 8ms)마다 쉬어 가며 계산한다. 판이 바뀌면 그만둔다
function startThinking(room, g, botId, tier, key) {
  if (!wantSearch(g, tier)) return null;
  let it;
  try { it = searchIter(g, botId, tier, tierOfIn(room)); } catch (e) { console.error('think', e); return null; }
  const job = { done: false, move: null, moves: g.moves, onDone: null };
  const step = () => {
    if (room.game !== g || g.finished || room.turnKey !== key) { job.done = true; job.move = null; return; }
    try {
      const t0 = Date.now(); let r;
      do { r = it.next(); } while (!r.done && Date.now() - t0 < 8);
      if (!r.done) { setImmediate(step); return; }
      job.move = r.value;
    } catch (e) { console.error('think', e); job.move = null; }
    job.done = true;
    if (job.onDone) { const f = job.onDone; job.onDone = null; f(); }
  };
  setImmediate(step);
  return job;
}
// 봇이 수를 둔다: 고민해 둔 수가 있으면 그걸, 없거나 안 맞으면 바로 판단 (계산 없이)
function playBot(room, g, botId, tier, planned) {
  if (planned) {
    const res = planned.draw ? g.draw(botId) : g.play(botId, planned.ids, planned.suit);
    if (res && res.ok) return;
  }
  const mv = chooseMove(g, botId, tier, tierOfIn(room), { noSearch: true });
  const res = !mv || mv.draw ? g.draw(botId) : g.play(botId, mv.ids, mv.suit);
  if (!res || !res.ok) g.draw(botId);
}

function extendTurn(room, ms) {
  const g = room.game;
  const cur = g.cur();
  room.deadline += ms;
  clearTimeout(room.turnTimer);
  room.turnTimer = setTimeout(() => whenUnpaused(room, () => {
    if (room.game === g && !g.finished && g.cur().id === cur.id) {
      g.addLog(`${honor(cur)} 시간 초과`);
      g.draw(cur.id);
      after(room);
    }
  }, 'turnTimer'), room.deadline - Date.now());
}

// --- 봇 이모티콘: 등급마다 성격이 조금 다르고, 너무 자주 하지 않는다 ---
const BOT_MOOD = {
  silver: { rate: 0.55, hurt: ['😭', '😱', '아 안 돼!'], attack: ['🔥', '공격 간다!'], caught: ['ㅋㅋㅋㅋ', '😂'], win: ['😀', '운이 좋네요'] },
  gold: { rate: 0.4, hurt: ['😭', '아 안 돼!'], attack: ['🔥', '공격 간다!'], caught: ['😂', '👍'], win: ['😎', '운이 좋네요'] },
  platinum: { rate: 0.3, hurt: ['😱', '봐주세요'], attack: ['🔥'], caught: ['👍', '원카드 조심!'], win: ['😎', '잘했어요'] },
  master: { rate: 0.22, hurt: ['😡'], attack: ['😎'], caught: ['👏', '원카드 조심!'], win: ['😎', '한 판 더?'] },
  grandmaster: { rate: 0.15, hurt: ['💀'], attack: ['😎'], caught: ['👍'], win: ['😎', '한 판 더?'] },
  challenger: { rate: 0.12, hurt: ['😡'], attack: ['🔥'], caught: ['😎'], win: ['😎'] },
};
function botEmote(room, m, kind) {
  const mood = BOT_MOOD[m.tier] || BOT_MOOD.gold;
  const now = Date.now();
  if (kind !== 'win' && Math.random() > mood.rate) return;
  if (now - (m.lastEmote || 0) < 9000 || now - (room.lastBotEmote || 0) < 3000) return; // 너무 자주 하지 않게
  m.lastEmote = now; room.lastBotEmote = now;
  const list = mood[kind];
  const text = list[Math.floor(Math.random() * list.length)];
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    io.to(room.code).emit('emote', { id: m.id, name: m.name, text, kind: EMOJIS.includes(text) ? 'emoji' : 'phrase' });
  }, 500 + Math.random() * 700);
}

// --- 원카드 버튼 경쟁 ---
// 카운트다운(3초) → 버튼 열림 → 2초 동안 누르기 → 모두 눌렀거나 2초가 지나면 결과 + 판 재개
// 가장 먼저 누른 사람이 승부를 정한다: 본인이면 안전, 남이면 본인 1장 벌칙. 아무도 안 누르면 벌칙 없음.
// race = { id, target, openAt, closeAt, eligible: [id], presses: [{ id, ms, first }], doneAt }
function raceView(room) {
  const r = room.race;
  if (!r) return null;
  const name = (id) => (room.members.find((m) => m.id === id) || {}).name || '?';
  return {
    id: r.id,
    target: r.target,
    targetName: name(r.target),
    openIn: Math.max(0, r.openAt - Date.now()), // 버튼이 열리기까지 남은 시간 (기기 시계 차이 없이)
    closeIn: Math.max(0, r.closeAt - Date.now()),
    done: !!r.doneAt,
    resumeIn: r.doneAt ? Math.max(0, r.doneAt + ONECARD_RESULT_MS - Date.now()) : null, // 판이 다시 움직이기까지
    eligible: r.eligible.map((id) => ({ id, name: name(id) })),
    presses: r.presses.map((p) => ({ ...p, name: name(p.id) })),
  };
}

// 원카드 버튼 누름 (사람·봇 공통). 기록이 남으면 { ms, place } 반환
function pressOneCard(room, id) {
  const g = room.game;
  const r = room.race;
  if (!g || !r || r.doneAt) return null;
  const now = Date.now();
  if (now < r.openAt || now > r.closeAt) return null; // 카운트다운 중이거나 시간이 지났다
  if (!r.eligible.includes(id) || r.presses.some((p) => p.id === id)) return null;
  const first = r.presses.length === 0;
  if (first && g.oneCard && g.oneCard.playerId === r.target) {
    g.callOneCard(id); // 승부는 가장 먼저 누른 사람이
    const m = room.members.find((x) => x.id === id);
    const t = room.members.find((x) => x.id === r.target);
    if (m && m.bot && id !== r.target) botEmote(room, m, 'caught'); // 남의 원카드를 잡았다
    else if (t && t.bot && id !== r.target) botEmote(room, t, 'hurt'); // 봇이 잡혔다
  }
  r.presses.push({ id, ms: now - r.openAt, first });
  // 모두 눌렀으면 바로 결과
  if (r.presses.length >= r.eligible.length) finishRace(room, r);
  return { ms: now - r.openAt, place: r.presses.length };
}

function finishRace(room, race) {
  if (race.doneAt || room.race !== race) return;
  race.doneAt = Date.now();
  const g = room.game;
  if (g && g.oneCard && g.oneCard.playerId === race.target) g.oneCard = null; // 아무도 안 눌렀으면 벌칙 없이 넘어감
  (room.oneCardTimers || []).forEach(clearTimeout);
  room.oneCardTimers = [];
  after(room);
  // 결과를 보여 주는 동안 판은 멈춰 있다가, 끝나면 모두에게 동시에 재개를 알린다
  room.oneCardTimers.push(setTimeout(() => { if (room.race === race) broadcast(room); }, ONECARD_RESULT_MS + 20));
}

// 새 원카드 상황이 생기면 경쟁을 연다. 봇은 등급별 반응 속도로 누른다
function scheduleOneCard(room) {
  const g = room.game;
  const targetId = g && !g.finished && g.oneCard ? g.oneCard.playerId : null;
  if (targetId === room.oneCardFor) return;
  room.oneCardFor = targetId;
  if (!targetId) return;
  (room.oneCardTimers || []).forEach(clearTimeout);
  room.oneCardTimers = [];
  const openAt = Date.now() + ONECARD_COUNTDOWN_MS;
  const eligible = g.players.filter((p) => !p.out || p.id === targetId).map((p) => p.id)
    .filter((id) => { const m = room.members.find((x) => x.id === id); return m && (m.bot || m.socketId); }); // 접속 중인 사람과 봇
  room.raceSeq = (room.raceSeq || 0) + 1; // 판이 바뀌어도 이어지는 번호 (다시 하기 뒤 예전 기록과 섞이지 않게)
  const race = { id: room.raceSeq, target: targetId, openAt, closeAt: openAt + ONECARD_WINDOW_MS, eligible, presses: [], doneAt: 0, moves: g.moves };
  room.race = race;
  room.oneCardTimers.push(setTimeout(() => finishRace(room, race), race.closeAt - Date.now() + 30));
  const fire = (callerId) => {
    if (room.game !== g || room.race !== race) return;
    if (pressOneCard(room, callerId) && !race.doneAt) broadcast(room);
  };
  for (const m of room.members) {
    if (!m.bot || !eligible.includes(m.id)) continue;
    const r = REACTION[m.tier] || REACTION.gold;
    const own = m.id === targetId;
    if (Math.random() >= (own ? r.self : r.catch)) continue; // 이번엔 놓친다 (실패)
    const [a, b] = own ? r.selfMs : r.catchMs;
    room.oneCardTimers.push(setTimeout(() => fire(m.id), ONECARD_COUNTDOWN_MS + a + Math.random() * (b - a)));
  }
}

function after(room) {
  room.lastAt = Date.now();
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
    if (!r.doneAt && g.moves !== r.moves && !g.finished) bad.push(`원카드 중에 수를 둠 (${r.moves}→${g.moves})`);
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
    clearTimeout(room.introTimer);
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
  // 안전장치: 이벤트 하나에서 오류가 나도 서버 전체가 멈추지 않게, 지나치게 잦은 요청은 무시
  const hits = [];
  const rawOn = socket.on.bind(socket);
  socket.on = (ev, fn) => rawOn(ev, (...args) => {
    const now = Date.now();
    while (hits.length && now - hits[0] > 1000) hits.shift();
    if (ev !== 'disconnect' && hits.length >= 25) return; // 1초에 25번 넘게 보내면 잠깐 무시 (연결 끊김은 항상 처리)
    hits.push(now);
    try { fn(...args); } catch (e) { console.error('handler error', ev, e && e.stack); if (room && room.game) { try { room.turnKey = null; after(room); } catch {} } }
  });

  const fail = (msg) => socket.emit('toast', msg);

  socket.on('create', (data) => {
    const { name, uid } = data || {};
    if (room || !validUid(uid)) return;
    const code = makeCode();
    room = { code, host: uid, members: [], game: null };
    rooms.set(code, room);
    memberId = uid;
    room.members.push({ id: uid, name: cleanName(name), bot: false, socketId: socket.id });
    socket.join(code);
    broadcast(room);
  });

  socket.on('join', (data) => {
    const { name, uid, code } = data || {};
    if (room || !validUid(uid)) return;
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) { socket.emit('noRoom'); return fail('방을 찾을 수 없어요. 코드를 확인하거나 방을 새로 만들어 주세요.'); }
    const existing = r.members.find((m) => m.id === uid);
    if (existing && existing.socketId && existing.socketId !== socket.id && io.sockets.sockets.has(existing.socketId)) {
      // 같은 ID가 다른 탭에서 아직 접속 중 → 새 ID로 다시 참가하게 함
      return socket.emit('uidTaken', { code: r.code });
    }
    if (existing) {
      // 재접속
      clearTimeout(existing.graceTimer);
      existing.socketId = socket.id;
      if (r.game && !r.game.finished && r.game.cur().id === uid) r.turnKey = null; // 돌아오면 내 차례 시간을 새로
    } else {
      if (r.game && !r.game.finished) return fail('이미 게임이 진행 중이에요.');
      if (r.members.length >= MAX_PLAYERS) return fail('방이 가득 찼어요. (최대 6명)');
      r.members.push({ id: uid, name: cleanName(name), bot: false, socketId: socket.id });
    }
    room = r;
    memberId = uid;
    socket.join(r.code);
    if (r.game && !r.game.finished) after(r); else broadcast(r);
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
    // 먼저 할 사람 고르기: 둘이면 동전 던지기, 셋 이상이면 룰렛 (결과는 서버가 정함)
    const g = room.game;
    room.introSeq = (room.introSeq || 0) + 1;
    room.intro = { id: room.introSeq, kind: g.players.length === 2 ? 'coin' : 'roulette', order: g.players.map((p) => p.id), starter: g.cur().id, until: Date.now() + INTRO_MS };
    clearTimeout(room.introTimer);
    room.introTimer = setTimeout(() => broadcast(room), INTRO_MS + 20);
    after(room);
  });

  socket.on('play', (data) => {
    const { cardId, cardIds, suit } = data || {};
    if (!room || !room.game) return;
    if (pausedFor(room) > 0) return fail(introLeft(room) > 0 ? '먼저 할 사람을 고르는 중이에요.' : '원카드 확인 중이에요. 잠깐만요!');
    const ids = Array.isArray(cardIds) ? cardIds.slice(0, 4) : cardId;
    const res = room.game.play(memberId, ids, suit);
    if (!res.ok) return fail(res.error);
    after(room);
  });

  socket.on('draw', () => {
    if (!room || !room.game) return;
    if (pausedFor(room) > 0) return fail(introLeft(room) > 0 ? '먼저 할 사람을 고르는 중이에요.' : '원카드 확인 중이에요. 잠깐만요!');
    const res = room.game.draw(memberId);
    if (!res.ok) return fail(res.error);
    after(room);
  });

  // 관전 건너뛰기: 나는 이미 끝났고(1등·파산 등) 남은 사람이 모두 봇이면, 남은 판을 그 자리에서 끝까지 계산해 바로 결과를 보여 준다
  socket.on('skipSpectate', () => {
    const g = room && room.game;
    if (!g || g.finished) return;
    const me = g.players.find((p) => p.id === memberId);
    const isBot = (id) => { const m = room.members.find((x) => x.id === id); return !!(m && m.bot); };
    if (!me || !me.out) return fail('내 판이 끝난 뒤에 건너뛸 수 있어요.');
    if (!g.alive().every((p) => isBot(p.id))) return fail('아직 사람이 남아 있어서 건너뛸 수 없어요.');
    if (introLeft(room) > 0) return;
    clearTimeout(room.botTimer); clearTimeout(room.turnTimer);
    (room.oneCardTimers || []).forEach(clearTimeout); room.oneCardTimers = [];
    room.race = null; room.oneCardFor = null; room.deadline = null; room.turnKey = null;
    const tierOf = (id) => (room.members.find((x) => x.id === id) || {}).tier || 'gold';
    // 원카드 경쟁은 봇마다 등급별 반응 확률과 시간으로 바로 판정 (판에서와 같은 기준)
    const race = () => {
      const target = g.oneCard.playerId;
      let best = null;
      for (const p of g.players) {
        if (p.out && p.id !== target) continue;
        if (!isBot(p.id)) continue;
        const r = REACTION[tierOf(p.id)] || REACTION.gold;
        const own = p.id === target;
        if (Math.random() >= (own ? r.self : r.catch)) continue;
        const [a, b] = own ? r.selfMs : r.catchMs;
        const t = a + Math.random() * (b - a);
        if (t > ONECARD_WINDOW_MS) continue;
        if (!best || t < best.t) best = { id: p.id, t };
      }
      if (best) g.callOneCard(best.id); else g.oneCard = null;
    };
    let steps = 0;
    if (g.oneCard) race();
    while (!g.finished && steps++ < 5000) {
      const cur = g.cur();
      g.botMove(cur.id, tierOf(cur.id), { noSearch: true });
      if (g.oneCard) race();
    }
    g.addLog(`${me.name}님이 관전을 건너뛰어 남은 판을 바로 끝냈어요.`);
    after(room);
  });

  socket.on('oneCard', () => {
    if (!room || !room.game) return;
    const res = pressOneCard(room, memberId);
    if (!res) return;
    socket.emit('pressed', { raceId: room.race.id, ...res }); // 내 기록은 바로 알려 준다
    if (!room.race.doneAt) broadcast(room);
  });

  let chatTimes = [];
  socket.on('chat', (text) => {
    if (!room) return;
    const now = Date.now();
    chatTimes = chatTimes.filter((t) => now - t < 5000);
    if (chatTimes.length >= 5) return fail('채팅이 너무 빨라요. 잠깐 뒤에 보내 주세요.');
    chatTimes.push(now);
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
      // 게임 중에는 잠시 기다렸다가 내보냄. 그 사람 차례였다면 금방 넘어가게
      m.graceTimer = setTimeout(() => leaveRoom(r, m.id), RECONNECT_GRACE_MS);
      if (r.game.cur().id === m.id) r.turnKey = null;
      after(r);
    } else {
      leaveRoom(r, m.id);
    }
  });
});

// --- 감시: 판이 이유 없이 멈추면 다시 움직이게 한다 ---
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    try {
      const g = room.game;
      if (!g || g.finished) continue;
      const r = room.race;
      // 원카드 경쟁이 끝날 시간이 한참 지났는데 안 끝났으면 끝낸다
      if (r && !r.doneAt && now > r.closeAt + 2000) { console.error('watchdog: race', room.code); finishRace(room, r); continue; }
      if (pausedFor(room) > 0) continue;
      const limit = (room.deadline ? Math.max(0, room.deadline - (room.lastAt || now)) : 4000) + STUCK_MS;
      if (now - (room.lastAt || now) > limit) {
        console.error('watchdog: restart turn', room.code);
        room.turnKey = null;
        after(room);
      }
    } catch (e) { console.error('watchdog error', room.code, e && e.stack); }
  }
}, 5000).unref();

// 예상하지 못한 오류로 서버가 꺼지지 않게 (기록만 남김)
process.on('uncaughtException', (e) => console.error('uncaught', e && e.stack));
process.on('unhandledRejection', (e) => console.error('unhandled', e && e.stack));

server.listen(PORT, () => {
  console.log(`원카드 서버 실행 중: http://localhost:${PORT}`);
});
