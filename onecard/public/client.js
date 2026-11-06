(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io();

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  // 플레이어 ID는 탭마다 따로 (같은 브라우저에서 탭 두 개로 들어와도 다른 사람으로 인식)
  const tabStore = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  };
  const newUid = () => 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  let uid = tabStore.get('onecard-uid');
  if (!uid) { uid = newUid(); tabStore.set('onecard-uid', uid); }
  $('name').value = store.get('onecard-name') || '';

  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('code').value = params.get('room').toUpperCase();

  let state = null;
  let seenSeq = 0;
  let pendingSeven = null;
  let lastTop = null;
  let shownResult = false;
  const chatLines = [];

  const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RED = { H: 1, D: 1 };

  function show(screen) {
    for (const s of ['home', 'lobby', 'game']) $(s).hidden = s !== screen;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  function bubble(text) {
    const b = $('bubble');
    b.hidden = true; void b.offsetWidth;
    b.textContent = text; b.hidden = false;
  }

  function myName() {
    const n = $('name').value.trim();
    if (!n) { toast('닉네임을 입력해 주세요.'); $('name').focus(); return null; }
    store.set('onecard-name', n);
    return n;
  }

  // --- 카드 그리기 ---
  function cardEl(c, tag = 'div') {
    const el = document.createElement(tag);
    el.className = 'card';
    if (c.rank === 'JOKER') {
      const color = c.suit === 'CJ';
      el.classList.add('joker');
      if (color) el.classList.add('color', 'red');
      el.innerHTML = `<div class="c-mid">🃏<small>${color ? 'COLOR' : 'BLACK'} JOKER</small></div>`;
      el.setAttribute('aria-label', color ? '컬러 조커' : '흑백 조커');
    } else {
      if (RED[c.suit]) el.classList.add('red');
      const s = SYM[c.suit];
      el.innerHTML = `<div class="c-tl">${c.rank}<small>${s}</small></div><div class="c-mid">${s}</div><div class="c-br">${c.rank}<small>${s}</small></div>`;
      el.setAttribute('aria-label', s + c.rank);
    }
    return el;
  }

  // --- 화면 그리기 ---
  function render() {
    if (!state) return;
    const { lobby, game, me } = state;
    renderLobby(lobby, me);
    if (!game || (game.finished && shownResult === 'closed')) { show('lobby'); return; }
    show('game');
    renderGame(game, me, lobby);
  }

  function renderLobby(lobby, me) {
    $('roomCode').textContent = lobby.code;
    const ul = $('members');
    ul.innerHTML = '';
    for (const m of lobby.members) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${m.bot ? '🤖' : '🙂'}</span><span class="n"></span>`;
      li.querySelector('.n').textContent = m.name + (m.id === me ? ' (나)' : '');
      if (m.id === lobby.host) li.insertAdjacentHTML('beforeend', '<span class="tag">방장</span>');
      if (!m.online) li.insertAdjacentHTML('beforeend', '<span class="tag off">연결 끊김</span>');
      if (lobby.host === me && m.id !== me) {
        const k = document.createElement('button');
        k.className = 'btn small ghost kick'; k.textContent = '내보내기';
        k.onclick = () => socket.emit('kick', m.id);
        li.appendChild(k);
      }
      ul.appendChild(li);
    }
    const isHost = lobby.host === me;
    $('hostControls').hidden = !isHost;
    $('waitMsg').hidden = isHost;
    $('btnBot').disabled = lobby.members.length >= 6;
  }

  function renderGame(g, me, lobby) {
    const myIdx = g.players.findIndex((p) => p.id === me);
    const myTurn = g.turn === me && !g.finished;

    // 상대: 내 다음 순서부터
    const opp = $('opponents');
    opp.innerHTML = '';
    const n = g.players.length;
    for (let i = 1; i < n; i++) {
      const p = g.players[(myIdx + i) % n];
      const online = (lobby.members.find((m) => m.id === p.id) || {}).online;
      const d = document.createElement('div');
      d.className = 'opp' + (p.id === g.turn && !g.finished ? ' turn' : '') + (p.out ? ' out' : '') + (p.count === 1 ? ' warn' : '');
      let badge = '';
      if (p.rank) badge = `<div class="badge">🏆 ${p.rank}등</div>`;
      else if (p.bankrupt) badge = '<div class="badge bad">💥 파산</div>';
      else if (p.out) badge = '<div class="badge bad">나감</div>';
      else if (!online && !p.bot) badge = '<div class="badge bad">연결 끊김</div>';
      else if (g.oneCard === p.id) badge = '<div class="badge bad">원카드?</div>';
      d.dataset.id = p.id;
      d.innerHTML = `<div class="nm"></div><div class="cnt"><span class="mini"></span>${p.out ? '-' : p.count}</div>${badge}`;
      d.querySelector('.nm').textContent = (p.bot ? '🤖 ' : '') + p.name;
      opp.appendChild(d);
    }

    // 상태 문구
    const cur = g.players.find((p) => p.id === g.turn);
    let st = '';
    if (g.finished) st = '게임 종료!';
    else if (myTurn) st = '내 차례!';
    else st = `${cur ? cur.name : ''}님 차례`;
    if (g.penalty > 0 && !g.finished) st += ` <span class="atk">· 공격 ${g.penalty}장!</span>`;
    st += ` <span style="color:var(--muted)">${g.dir === 1 ? '↻' : '↺'}</span>`;
    $('status').innerHTML = st;

    // 바닥
    const pile = $('pile');
    const topKey = g.top.id;
    if (topKey !== lastTop) {
      pile.innerHTML = '';
      const el = cardEl(g.top);
      if (lastTop !== null) el.classList.add('new');
      pile.appendChild(el);
      lastTop = topKey;
    }
    const badge = $('suitBadge');
    const showSuit = g.activeSuit && (g.top.rank === 'JOKER' || g.activeSuit !== g.top.suit);
    badge.textContent = showSuit ? SYM[g.activeSuit] : (g.top.rank === 'JOKER' && !g.activeSuit && g.penalty === 0 ? '★' : '');
    badge.className = 'suit-badge' + (showSuit && RED[g.activeSuit] ? ' red' : '');
    $('deckCount').textContent = g.deckCount;
    $('deck').classList.toggle('can', myTurn);

    // 버튼
    const meP = g.players[myIdx];
    $('btnDraw').disabled = !myTurn;
    $('btnDraw').textContent = g.penalty > 0 && myTurn ? `${g.penalty}장 먹기` : '카드 뽑기';
    const canOne = !!g.oneCard && !g.finished && !(meP && meP.out && g.oneCard !== me);
    $('btnOne').disabled = !canOne;
    $('btnOne').classList.toggle('pulse', g.oneCard === me);

    // 내 이름/타이머
    $('myName').textContent = (meP ? meP.name : '') + ` · ${g.hand.length}장` + (meP && meP.rank ? ` · 🏆 ${meP.rank}등` : '') + (meP && meP.bankrupt ? ' · 💥 파산' : '');
    document.querySelector('.me-bar').classList.toggle('turn', myTurn);

    // 손패
    const hand = $('hand');
    hand.innerHTML = '';
    const ok = new Set(g.playable);
    for (const c of g.hand) {
      const el = cardEl(c, 'button');
      el.type = 'button';
      if (myTurn) el.classList.add(ok.has(c.id) ? 'ok' : 'dim');
      el.onclick = () => playCard(c, ok.has(c.id), g);
      hand.appendChild(el);
    }

    // 기록
    const newCount = Math.min((g.logSeq || 0) - seenSeq, g.log.length);
    if (seenSeq && newCount > 0) {
      for (const line of g.log.slice(-newCount)) {
        if (line.includes('원카드!')) bubble('원카드!');
        else if (line.includes('벌칙')) bubble('🚨 벌칙!');
        else if (line.includes('파산')) bubble('💥 파산!');
        else if (line.includes('방어')) bubble('🛡️ 방어!');
        else if (line.includes('등!')) bubble(line.replace(/^🏆\s*/, '🏆 '));
      }
    }
    seenSeq = g.logSeq || 0;
    renderLog(g.log);

    // 결과
    if (g.finished && !shownResult) {
      shownResult = true;
      setTimeout(() => showResults(g, me, lobby), 900);
    }
  }

  function renderLog(lines) {
    const ul = $('log');
    ul.innerHTML = '';
    for (const l of lines) {
      const li = document.createElement('li'); li.textContent = l; ul.appendChild(li);
    }
    for (const c of chatLines.slice(-15)) {
      const li = document.createElement('li'); li.className = 'chat'; li.textContent = `${c.name}: ${c.text}`; ul.appendChild(li);
    }
    ul.scrollTop = ul.scrollHeight;
  }

  function showResults(g, me, lobby) {
    const list = g.players.slice().sort((a, b) => {
      const ra = a.rank || 99, rb = b.rank || 99;
      return ra - rb;
    });
    const ol = $('results');
    ol.innerHTML = '';
    for (const p of list) {
      const li = document.createElement('li');
      if (p.id === me) li.className = 'me';
      const medal = p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : p.rank ? p.rank + '등' : '-';
      li.innerHTML = `<span class="pl">${medal}</span><span class="n"></span>`;
      li.querySelector('.n').textContent = p.name + (p.bankrupt ? ' 💥 파산' : '') + (!p.rank && !p.bankrupt ? ' (나감)' : '');
      ol.appendChild(li);
    }
    const isHost = state.lobby.host === me;
    $('btnAgain').hidden = !isHost;
    $('resultModal').hidden = false;
  }

  function playCard(c, playable, g) {
    if (g.turn !== state.me) return toast('내 차례가 아니에요.');
    if (!playable) return toast('낼 수 없는 카드예요.');
    if (c.rank === '7' && g.penalty === 0) {
      pendingSeven = c.id;
      $('suitModal').hidden = false;
      return;
    }
    socket.emit('play', { cardId: c.id });
  }

  // --- 타이머 표시 ---
  setInterval(() => {
    const t = $('timer');
    if (!state || !state.game || !state.deadline || state.game.finished) { t.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    t.textContent = state.game.turn === state.me ? `⏱ ${left}` : '';
    t.classList.toggle('low', left <= 10);
  }, 250);

  // --- 이벤트 ---
  $('btnCreate').onclick = () => { const n = myName(); if (n) socket.emit('create', { name: n, uid }); };
  $('btnJoin').onclick = () => {
    const n = myName(); if (!n) return;
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 4) return toast('4자리 방 코드를 입력해 주세요.');
    socket.emit('join', { name: n, uid, code });
  };
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('code').value ? $('btnJoin') : $('btnCreate')).click(); });

  $('btnCopy').onclick = async () => {
    const code = state.lobby.code;
    try { await navigator.clipboard.writeText(code); toast(`방 코드 ${code}를 복사했어요!`); }
    catch { toast(`방 코드: ${code}`); }
  };
  $('btnBot').onclick = () => socket.emit('addBot');
  $('btnStart').onclick = () => socket.emit('start');
  $('btnLeave').onclick = () => {
    socket.emit('leave'); state = null; show('home');
    history.replaceState(null, '', location.pathname);
  };

  $('btnDraw').onclick = () => socket.emit('draw');
  $('deck').onclick = () => { if (state && state.game && state.game.turn === state.me) socket.emit('draw'); };
  $('btnOne').onclick = () => socket.emit('oneCard');
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && !$('game').hidden) { e.preventDefault(); socket.emit('oneCard'); }
  });

  document.querySelectorAll('#suitModal [data-suit]').forEach((b) => {
    b.onclick = () => {
      $('suitModal').hidden = true;
      if (pendingSeven !== null) socket.emit('play', { cardId: pendingSeven, suit: b.dataset.suit });
      pendingSeven = null;
    };
  });
  $('suitCancel').onclick = () => { $('suitModal').hidden = true; pendingSeven = null; };

  $('btnAgain').onclick = () => { $('resultModal').hidden = true; socket.emit('start'); };
  $('btnToLobby').onclick = () => { $('resultModal').hidden = true; shownResult = 'closed'; render(); };

  // --- 빠른 이모티콘 / 채팅 ---
  const EMOJIS = ['😀', '😂', '😎', '😭', '😡', '😱', '👍', '👏', '🔥', '💀'];
  const PHRASES = ['빨리 내요!', '잘했어요 👍', '아 안 돼!', '봐주세요 🙏', '원카드 조심!', '공격 간다!', '운이 좋네요', '한 판 더?', 'ㅋㅋㅋㅋ', '안녕하세요 👋'];
  for (const e of EMOJIS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = e;
    b.onclick = () => { socket.emit('emote', e); $('emotePanel').hidden = true; };
    $('emojiRow').appendChild(b);
  }
  for (const t of PHRASES) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
    b.onclick = () => { socket.emit('emote', t); $('emotePanel').hidden = true; };
    $('phraseList').appendChild(b);
  }
  $('btnEmote').onclick = (e) => { e.stopPropagation(); $('emotePanel').hidden = !$('emotePanel').hidden; };
  document.addEventListener('click', (e) => {
    if (!$('emotePanel').hidden && !$('emotePanel').contains(e.target)) $('emotePanel').hidden = true;
  });

  function floatEmote({ id, text, kind }) {
    // 보낸 사람 자리 위에 띄움 (나는 손패 위)
    let anchor = state && id === state.me ? document.querySelector('.me-bar') : document.querySelector(`.opp[data-id="${id}"]`);
    if (!anchor || $('game').hidden) return;
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'emote-float ' + kind;
    el.textContent = text;
    const isOpp = id !== state.me;
    el.style.left = Math.min(Math.max(r.left + r.width / 2, 60), window.innerWidth - 60) + 'px';
    el.style.top = (isOpp ? r.bottom + 56 : r.top) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  $('btnLog').onclick = () => { $('side').hidden = false; $('btnLog').classList.remove('dot'); };
  $('btnCloseSide').onclick = () => { $('side').hidden = true; };
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('chatInput').value.trim();
    if (v) socket.emit('chat', v);
    $('chatInput').value = '';
  };

  // --- 소켓 ---
  socket.on('state', (s) => {
    const prevGame = state && state.game;
    // 새 게임이 시작되면 결과 상태 초기화
    if (s.game && !s.game.finished && (!prevGame || prevGame.finished)) {
      shownResult = false; lastTop = null; seenSeq = 0; $('resultModal').hidden = true;
    }
    state = s;
    history.replaceState(null, '', `${location.pathname}?room=${s.lobby.code}`);
    render();
  });
  socket.on('toast', toast);
  // 같은 ID가 이미 다른 탭에서 접속 중이면 새 ID로 다시 참가
  socket.on('uidTaken', ({ code }) => {
    uid = newUid(); tabStore.set('onecard-uid', uid);
    const name = store.get('onecard-name') || $('name').value.trim();
    socket.emit('join', { name, uid, code });
  });
  socket.on('chat', (c) => {
    chatLines.push(c);
    if ($('side').hidden) { $('btnLog').classList.add('dot'); toast(`💬 ${c.name}: ${c.text}`); }
    if (state && state.game) renderLog(state.game.log);
  });
  socket.on('emote', (m) => {
    floatEmote(m);
    if (m.kind === 'phrase') {
      chatLines.push({ name: m.name, text: m.text });
      if (state && state.game) renderLog(state.game.log);
    }
  });
  socket.on('kicked', () => { state = null; show('home'); toast('방에서 내보내졌어요.'); history.replaceState(null, '', location.pathname); });

  // 재접속: 방 코드가 주소에 있고 이전에 닉네임이 있었다면 자동 참가 시도
  socket.on('connect', () => {
    const code = (state && state.lobby && state.lobby.code) || params.get('room');
    const name = store.get('onecard-name');
    if (code && name && (state || tabStore.get('onecard-last-room') === code.toUpperCase())) {
      socket.emit('join', { name, uid, code });
    }
  });
  socket.on('state', (s) => tabStore.set('onecard-last-room', s.lobby.code));
})();
