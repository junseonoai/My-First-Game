const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Game } = require('./game');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const TURN_SECONDS = 30;
const RECONNECT_GRACE_MS = 60_000;
const EMOJIS = ['😀', '😂', '😎', '😭', '😡', '😱', '👍', '👏', '🔥', '💀'];
const PHRASES = ['빨리 내요!', '잘했어요 👍', '아 안 돼!', '봐주세요 🙏', '원카드 조심!', '공격 간다!', '운이 좋네요', '한 판 더?', 'ㅋㅋㅋㅋ', '안녕하세요 👋'];
const BOT_NAMES = ['봇 철수', '봇 영희', '봇 민수', '봇 지수', '봇 하늘'];

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
    members: room.members.map((m) => ({ id: m.id, name: m.name, bot: m.bot, online: m.bot || !!m.socketId })),
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
  const member = room.members.find((m) => m.id === cur.id);
  if (member && member.bot) {
    room.botTimer = setTimeout(() => {
      if (room.game === g && !g.finished && g.cur().id === cur.id) {
        g.botMove(cur.id);
        after(room);
      }
    }, 900 + Math.random() * 900);
  } else {
    room.deadline = Date.now() + TURN_SECONDS * 1000;
    room.turnTimer = setTimeout(() => {
      if (room.game === g && !g.finished && g.cur().id === cur.id) {
        g.addLog(`⏰ ${cur.name}님 시간 초과`);
        g.draw(cur.id);
        after(room);
      }
    }, TURN_SECONDS * 1000);
  }
}

// 봇의 원카드 외치기/잡기 (대상이 바뀔 때만 타이머 재설정)
function scheduleOneCard(room) {
  const g = room.game;
  const targetId = g && !g.finished && g.oneCard ? g.oneCard.playerId : null;
  if (targetId === room.oneCardFor) return;
  clearTimeout(room.oneCardTimer);
  room.oneCardFor = targetId;
  if (!targetId) return;
  const owner = room.members.find((m) => m.id === targetId);
  const bots = room.members.filter((m) => m.bot && m.id !== targetId && g.find(m.id) && !g.find(m.id).out);
  const fire = (callerId) => {
    if (room.game === g && g.oneCard && g.oneCard.playerId === targetId) {
      g.callOneCard(callerId);
      after(room);
    }
  };
  if (owner && owner.bot && Math.random() < 0.85) {
    room.oneCardTimer = setTimeout(() => fire(owner.id), 500 + Math.random() * 1500);
  } else if (bots.length) {
    const catcher = bots[Math.floor(Math.random() * bots.length)];
    room.oneCardTimer = setTimeout(() => fire(catcher.id), 3000 + Math.random() * 3000);
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
    clearTimeout(room.oneCardTimer);
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

  socket.on('addBot', () => {
    if (!room || room.host !== memberId) return;
    if (room.game && !room.game.finished) return;
    if (room.members.length >= MAX_PLAYERS) return fail('방이 가득 찼어요.');
    const used = new Set(room.members.map((m) => m.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || '봇';
    room.members.push({ id: 'bot-' + Math.random().toString(36).slice(2, 9), name, bot: true });
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
    room.game = new Game(room.members.map((m) => ({ id: m.id, name: m.name, bot: m.bot })));
    after(room);
  });

  socket.on('play', ({ cardId, suit }) => {
    if (!room || !room.game) return;
    const res = room.game.play(memberId, cardId, suit);
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
    const res = room.game.callOneCard(memberId);
    if (!res.ok) return;
    after(room);
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
