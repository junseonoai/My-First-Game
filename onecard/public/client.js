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
  let pendingSeven = null; // 7을 낼 때 무늬 고르기 대기 중인 카드 id 목록
  let selected = []; // 여러 장 내기: 고른 카드 id (내는 순서)
  let selTurnKey = null;
  const pileSeen = new Set(); // 바닥에 이미 그린 카드
  const landing = new Set(); // 날아가는 중인 카드
  let anim = { prev: null, handRects: {} }; // 직전 상태 (애니메이션용)
  const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
    el.dataset.id = c.id;
    if (c.rank === 'JOKER') {
      const color = c.suit === 'CJ';
      el.classList.add('joker');
      if (color) el.classList.add('color', 'red');
      const idx = '<b>JOKER</b>';
      el.innerHTML = `<div class="idx tl">${idx}</div><div class="quad"><span>♠</span><span>♥</span><span>♦</span><span>♣</span></div><div class="idx br">${idx}</div>`;
      el.setAttribute('aria-label', color ? '컬러 조커' : '흑백 조커');
    } else {
      if (RED[c.suit]) el.classList.add('red');
      const s = SYM[c.suit];
      const idx = `<b>${c.rank}</b><s>${s}</s>`;
      const mid = ['J', 'Q', 'K'].includes(c.rank)
        ? `<div class="face"><b>${c.rank}</b><s>${s}</s></div>`
        : `<div class="pip">${s}</div>`;
      el.innerHTML = `<div class="idx tl">${idx}</div>${mid}<div class="idx br">${idx}</div>`;
      el.setAttribute('aria-label', s + c.rank);
    }
    return el;
  }
  function backEl() { const el = document.createElement('div'); el.className = 'card back'; return el; }

  // --- 날아가는 카드 ---
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // from/to: 화면 위 사각형. 카드는 to 크기로 그려서 from 크기에서 시작해 날아간다.
  function fly(make, from, to, { delay = 0, dur = 420, rotFrom = 0, rotTo = 0, endScale = 1, fade = false, onDone } = {}) {
    if (reduceMotion || !from || !to || !to.width) { if (onDone) onDone(); return; }
    const el = make();
    el.classList.add('flyer');
    el.style.width = to.width + 'px'; el.style.height = to.height + 'px';
    document.body.appendChild(el);
    const s0 = Math.max(.25, Math.min(1.2, from.width / to.width));
    const x0 = from.left + from.width / 2 - to.width / 2, y0 = from.top + from.height / 2 - to.height / 2;
    const anim = el.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(${rotFrom}deg) scale(${s0})`, opacity: 1 },
      { transform: `translate(${(x0 + to.left) / 2}px, ${Math.min(y0, to.top) - 30}px) rotate(${(rotFrom + rotTo) / 2}deg) scale(${(s0 + endScale) / 2 + .06})`, offset: .55, opacity: 1 },
      { transform: `translate(${to.left}px, ${to.top}px) rotate(${rotTo}deg) scale(${endScale})`, opacity: fade ? 0 : 1 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'both' });
    anim.onfinish = () => { el.remove(); if (onDone) onDone(); };
  }
  // 바닥에 놓인 카드의 기울기 (카드마다 고정)
  const tilt = (id) => ((id * 47) % 21) - 10;
  const nudge = (id) => ((id * 13) % 9) - 4;

  // --- 화면 그리기 ---  // --- 화면 그리기 ---
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
      li.innerHTML = `<span class="seat">${lobby.members.indexOf(m) + 1}</span><span class="n"></span>`;
      li.querySelector('.n').textContent = m.name + (m.id === me ? ' (나)' : '');
      if (m.id === lobby.host) li.insertAdjacentHTML('beforeend', '<span class="tag host">방장</span>');
      if (m.bot) li.insertAdjacentHTML('beforeend', '<span class="tag">BOT</span>');
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
      if (p.rank) badge = `<div class="badge">${p.rank}등</div>`;
      else if (p.bankrupt) badge = '<div class="badge bad">파산</div>';
      else if (p.out) badge = '<div class="badge bad">나감</div>';
      else if (!online && !p.bot) badge = '<div class="badge bad">연결 끊김</div>';
      else if (g.oneCard === p.id) badge = '<div class="badge bad">원카드?</div>';
      d.dataset.id = p.id;
      const shown = p.out ? 0 : Math.min(p.count, 7);
      let fan = '';
      for (let k = 0; k < shown; k++) {
        const a = (k - (shown - 1) / 2) * 7;
        fan += `<i style="left:calc(50% - 9px + ${(k - (shown - 1) / 2) * 6}px);transform:rotate(${a}deg)"></i>`;
      }
      d.innerHTML = `<div class="nm">${p.bot ? '<span class="bot">BOT</span>' : ''}<span></span></div><div class="fan">${fan}</div><div class="cnt">${p.out ? '–' : p.count + '장'}</div>${badge}`;
      d.querySelector('.nm span:last-child').textContent = p.name;
      opp.appendChild(d);
    }

    // 상태 문구
    const cur = g.players.find((p) => p.id === g.turn);
    let st = '';
    if (g.finished) st = '게임 종료';
    else if (myTurn) st = '내 차례';
    else st = `${cur ? escapeHtml(cur.name) : ''}님 차례`;
    st += `<span class="dir" title="진행 방향">${g.dir === 1 ? '↻' : '↺'}</span>`;
    $('status').innerHTML = st;
    $('status').classList.toggle('mine', myTurn);

    // 바닥: 최근 카드 몇 장이 살짝 비뚤게 쌓임. 새로 낸 카드는 낸 사람 자리에서 날아온다.
    const pile = $('pile');
    const recent = g.recent && g.recent.length ? g.recent : [g.top];
    const fresh = pileSeen.size ? recent.filter((c) => !pileSeen.has(c.id)) : [];
    pile.innerHTML = '';
    for (const c of recent) {
      const el = cardEl(c);
      el.style.transform = `translate(${nudge(c.id)}px, ${nudge(c.id * 3)}px) rotate(${tilt(c.id)}deg)`;
      if (landing.has(c.id) || fresh.includes(c)) el.style.visibility = 'hidden';
      pile.appendChild(el);
    }
    const pileRect = pile.getBoundingClientRect();
    const actor = anim.prev ? anim.prev.turn : null;
    fresh.forEach((c, i) => {
      landing.add(c.id);
      let from = null;
      if (actor === me) from = anim.handRects[c.id] || $('hand').getBoundingClientRect();
      else { const seat = document.querySelector(`.opp[data-id="${actor}"] .fan`); from = seat && seat.getBoundingClientRect(); }
      fly(() => cardEl(c), from, pileRect, {
        delay: i * 110, rotFrom: actor === me ? 0 : -20, rotTo: tilt(c.id),
        onDone: () => {
          landing.delete(c.id);
          const el = pile.querySelector(`.card[data-id="${c.id}"]`);
          if (el) el.style.visibility = '';
        },
      });
    });
    for (const c of recent) pileSeen.add(c.id);

    const badge = $('suitBadge');
    const showSuit = g.activeSuit && (g.top.rank === 'JOKER' || g.activeSuit !== g.top.suit);
    badge.textContent = showSuit ? SYM[g.activeSuit] : (g.top.rank === 'JOKER' && !g.activeSuit && g.penalty === 0 ? '★' : '');
    badge.className = 'suit-badge' + (showSuit && RED[g.activeSuit] ? ' red' : '');
    $('deckCount').textContent = `남은 카드 ${g.deckCount}`;
    $('deck').classList.toggle('can', myTurn);

    // 쌓인 공격 장수: 많을수록 더 크게, 더 격하게
    renderStack(g.finished ? 0 : g.penalty);

    // 버튼
    const meP = g.players[myIdx];
    $('btnDraw').disabled = !myTurn;
    $('btnDraw').textContent = g.penalty > 0 && myTurn ? `${g.penalty}장 먹기` : '카드 뽑기';
    $('btnDraw').classList.toggle('danger', g.penalty > 0 && myTurn);

    // 원카드 선착순 팝업
    const canOne = !!g.oneCard && !g.finished && !(meP && meP.out && g.oneCard !== me);
    $('onePop').hidden = !canOne;
    if (canOne) {
      const owner = g.players.find((p) => p.id === g.oneCard);
      $('oneMsg').textContent = g.oneCard === me ? '한 장 남았어요! 먼저 누르세요!' : `${owner ? owner.name : ''}님이 한 장! 먼저 누르면 벌칙!`;
      $('onePop').classList.toggle('mine', g.oneCard === me);
    }

    // 내 이름/타이머
    $('myName').textContent = (meP ? meP.name : '') + ` · ${g.hand.length}장` + (meP && meP.rank ? ` · ${meP.rank}등` : '') + (meP && meP.bankrupt ? ' · 파산' : '');
    document.querySelector('.me-bar').classList.toggle('turn', myTurn);

    // 손패
    const hand = $('hand');
    hand.innerHTML = '';
    // 새로 받은 카드 (이번 판 첫 화면에서는 애니메이션 없음)
    const prevHand = anim.prev && anim.prev.hand ? new Set(anim.prev.hand.map((c) => c.id)) : null;
    const newHandIds = new Set(prevHand ? g.hand.filter((c) => !prevHand.has(c.id)).map((c) => c.id) : []);
    const ok = new Set(g.playable);
    const kinds = g.playKind || {};
    // 차례가 바뀌거나 카드가 없어지면 선택 초기화
    const turnKey = `${g.turn}|${g.top.id}|${g.hand.length}|${g.penalty}`;
    if (!myTurn || selected.some((id) => !g.hand.find((c) => c.id === id))) selected = [];
    if (selTurnKey !== turnKey) { selected = []; selTurnKey = turnKey; }
    const selRank = selected.length ? (g.hand.find((c) => c.id === selected[0]) || {}).rank : null;
    for (const c of sortCards(g.hand)) {
      const el = cardEl(c, 'button');
      el.type = 'button';
      const si = selected.indexOf(c.id);
      if (si >= 0) {
        el.classList.add('sel');
        el.insertAdjacentHTML('beforeend', `<span class="sel-no">${si + 1}</span>`);
      } else if (selRank && c.rank === selRank) {
        el.classList.add('pick');
      } else if (myTurn) el.classList.add(...(ok.has(c.id) ? ['ok', 'k-' + (kinds[c.id] || 'normal')] : ['dim']));
      el.onclick = () => playCard(c, ok.has(c.id), g);
      if (newHandIds.has(c.id)) el.style.visibility = 'hidden';
      hand.appendChild(el);
    }
    animateDraws(g, me);
    const selecting = selected.length > 0;
    $('btnMulti').hidden = !selecting;
    $('btnMultiCancel').hidden = !selecting;
    $('btnDraw').hidden = selecting;
    $('multiHint').hidden = !selecting;
    $('btnMulti').textContent = `${selected.length}장 내기`;

    // 기록
    const newCount = Math.min((g.logSeq || 0) - seenSeq, g.log.length);
    if (seenSeq && newCount > 0) {
      for (const line of g.log.slice(-newCount)) {
        if (line.includes('원카드!')) bubble('원카드!');
        else if (line.includes('벌칙')) bubble('벌칙 1장');
        else if (line.includes('파산')) bubble('파산');
        else if (line.includes('막기')) bubble('막기!');
        else if (line.includes('한 번 더!')) bubble((line.match(/· ([^·]+? 한 번 더!)/) || [0, '한 번 더!'])[1]);
        else if (line.includes('등!')) bubble(line.replace(/!$/, ''));
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

  // --- 카드 뽑기 애니메이션: 덱에서 받은 사람에게 ---
  function animateDraws(g, me) {
    const prev = anim.prev;
    if (!prev) return;
    const deck = $('deck').getBoundingClientRect();
    for (const p of g.players) {
      const before = prev.players.find((x) => x.id === p.id);
      if (!before || p.out) continue;
      const delta = Math.min(p.count - before.count, 6);
      if (delta <= 0) continue;
      if (p.id === me) {
        const prevHand = new Set(prev.hand.map((c) => c.id));
        g.hand.filter((c) => !prevHand.has(c.id)).slice(-6).forEach((c, i) => {
          const el = document.querySelector(`#hand .card[data-id="${c.id}"]`);
          if (!el) return;
          fly(backEl, deck, el.getBoundingClientRect(), {
            delay: i * 90, dur: 380, rotFrom: -6,
            onDone: () => { el.style.visibility = ''; el.classList.add('dealt'); },
          });
        });
        // 6장 넘게 받은 경우 나머지는 바로 보이게
        g.hand.filter((c) => !prevHand.has(c.id)).slice(0, -6).forEach((c) => {
          const el = document.querySelector(`#hand .card[data-id="${c.id}"]`);
          if (el) el.style.visibility = '';
        });
      } else {
        const seat = document.querySelector(`.opp[data-id="${p.id}"] .fan`);
        if (!seat) continue;
        const r = seat.getBoundingClientRect();
        const target = { left: r.left + r.width / 2 - deck.width / 2, top: r.top + r.height / 2 - deck.height / 2, width: deck.width, height: deck.height };
        for (let i = 0; i < delta; i++) {
          // 자리 쪽으로 작아지며 날아간다
          fly(backEl, deck, target, { delay: i * 80, dur: 380, rotTo: 14, endScale: .3, fade: true });
        }
      }
    }
  }

  // --- 손패 정렬 ---
  const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'];
  const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3, BJ: 4, CJ: 5 };
  let sortMode = store.get('onecard-sort') === 'rank' ? 'rank' : 'suit';
  function sortCards(hand) {
    const bySuit = (a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    const byRank = (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
    return hand.slice().sort(sortMode === 'rank' ? (a, b) => byRank(a, b) || bySuit(a, b) : (a, b) => bySuit(a, b) || byRank(a, b));
  }
  function updateSortBtn() { $('btnSort').textContent = sortMode === 'rank' ? '숫자순' : '모양순'; }
  updateSortBtn();
  $('btnSort').onclick = () => {
    sortMode = sortMode === 'rank' ? 'suit' : 'rank';
    store.set('onecard-sort', sortMode);
    updateSortBtn();
    render();
  };

  // --- 쌓인 공격 표시 ---
  let lastPenalty = 0;
  function renderStack(n) {
    const el = $('stack');
    el.hidden = n <= 0;
    if (n > 0) {
      $('stackNum').textContent = n;
      const lv = n >= 15 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : 1;
      el.className = 'stack lv' + lv;
      if (n > lastPenalty) {
        el.classList.add('bump');
        clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('bump'), 360);
      }
    }
    lastPenalty = n;
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
      li.innerHTML = `<span class="pl">${p.rank || '–'}</span><span class="n"></span><span class="note">${p.bankrupt ? '파산' : !p.rank ? '나감' : ''}</span>`;
      li.querySelector('.n').textContent = p.name + (p.id === me ? ' (나)' : '');
      ol.appendChild(li);
    }
    const isHost = state.lobby.host === me;
    $('btnAgain').hidden = !isHost;
    $('resultModal').hidden = false;
  }

  function playCard(c, playable, g) {
    if (g.turn !== state.me) return toast('내 차례가 아니에요.');
    const selRank = selected.length ? (g.hand.find((x) => x.id === selected[0]) || {}).rank : null;
    // 선택 중: 같은 숫자면 넣거나 빼기
    if (selRank && c.rank === selRank) {
      const i = selected.indexOf(c.id);
      if (i === 0) selected = []; // 첫 장을 빼면 선택 취소
      else if (i > 0) selected.splice(i, 1);
      else selected.push(c.id);
      return render();
    }
    if (!playable) return toast('낼 수 없는 카드예요.');
    const partners = g.hand.filter((x) => x.id !== c.id && x.rank === c.rank);
    if (partners.length === 0) { selected = []; return submitPlay([c.id], g); }
    // 같은 숫자가 더 있으면 여러 장 고르기 시작
    selected = [c.id];
    render();
  }

  function submitPlay(ids, g) {
    const first = g.hand.find((x) => x.id === ids[0]);
    if (first && first.rank === '7' && g.penalty === 0) {
      pendingSeven = ids;
      $('suitModal').hidden = false;
      return;
    }
    socket.emit('play', { cardIds: ids });
    selected = [];
  }

  // --- 타이머 표시 ---
  setInterval(() => {
    const t = $('timer');
    if (!state || !state.game || !state.deadline || state.game.finished) { t.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    t.textContent = state.game.turn === state.me ? `${left}초` : '';
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
  $('btnMulti').onclick = () => { if (state && state.game && selected.length) submitPlay(selected.slice(), state.game); };
  $('btnMultiCancel').onclick = () => { selected = []; render(); };
  $('deck').onclick = () => { if (state && state.game && state.game.turn === state.me) socket.emit('draw'); };
  $('btnOne').onclick = () => socket.emit('oneCard');
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && !$('game').hidden) { e.preventDefault(); socket.emit('oneCard'); }
  });

  document.querySelectorAll('#suitModal [data-suit]').forEach((b) => {
    b.onclick = () => {
      $('suitModal').hidden = true;
      if (pendingSeven !== null) socket.emit('play', { cardIds: pendingSeven, suit: b.dataset.suit });
      selected = [];
      pendingSeven = null;
    };
  });
  $('suitCancel').onclick = () => { $('suitModal').hidden = true; pendingSeven = null; };

  $('btnAgain').onclick = () => { $('resultModal').hidden = true; socket.emit('start'); };
  $('btnToLobby').onclick = () => { $('resultModal').hidden = true; shownResult = 'closed'; render(); };

  // --- 빠른 이모티콘 / 채팅 ---
  const EMOJIS = ['😀', '😂', '😎', '😭', '😡', '😱', '👍', '👏', '🔥', '💀'];
  const PHRASES = ['빨리 내요!', '잘했어요', '아 안 돼!', '봐주세요', '원카드 조심!', '공격 간다!', '운이 좋네요', '한 판 더?', 'ㅋㅋㅋㅋ', '안녕하세요'];
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
    el.style.top = (isOpp ? r.bottom + 58 : r.top) + 'px';
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
      shownResult = false; seenSeq = 0; $('resultModal').hidden = true; pileSeen.clear();
    }
    // 애니메이션용: 바뀌기 전 상태와 내 카드 위치
    const handRects = {};
    document.querySelectorAll('#hand .card').forEach((el) => { handRects[el.dataset.id] = el.getBoundingClientRect(); });
    const sameGame = prevGame && s.game && !(s.game && !s.game.finished && prevGame.finished);
    anim = { prev: sameGame ? prevGame : null, handRects };
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
    if ($('side').hidden) { $('btnLog').classList.add('dot'); toast(`${c.name}: ${c.text}`); }
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
