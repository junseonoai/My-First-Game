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
  // --- 카드 그림 (직접 그린 SVG) ---
  const INK = '#1a1a1a', GOLD = '#d9a520', SKIN = '#f7e1c0', RED_C = '#b3232a', BLUE_C = '#23458f', GREEN_C = '#2f7a4f';
  // 그림 카드 위쪽 절반 (44×52 안에 그림, 아래쪽은 뒤집어서 같은 그림)
  function courtHalf(rank, suit) {
    const red = suit === 'H' || suit === 'D';
    const main = red ? RED_C : BLUE_C, alt = red ? BLUE_C : RED_C;
    const sc = red ? RED_C : INK;
    const robe = `
      <path d="M4 52 L6 35 Q8 26 16 24 L28 24 Q36 26 38 35 L40 52 Z" fill="${main}" stroke="${INK}" stroke-width=".8"/>
      <path d="M6 35 Q8 30 12 28 L12 52 L4 52 Z" fill="${alt}" stroke="${INK}" stroke-width=".5"/>
      <path d="M38 35 Q36 30 32 28 L32 52 L40 52 Z" fill="${alt}" stroke="${INK}" stroke-width=".5"/>
      <rect x="19" y="24" width="6" height="28" fill="${GOLD}" stroke="${INK}" stroke-width=".5"/>
      ${[29, 34, 39, 44, 49].map((y) => `<path d="M22 ${y - 1.6} L23.4 ${y} L22 ${y + 1.6} L20.6 ${y} Z" fill="${INK}"/>`).join('')}
      <path d="M13.5 25 Q22 32 30.5 25 L29.5 22.6 Q22 27.5 14.5 22.6 Z" fill="#fff" stroke="${INK}" stroke-width=".5"/>
      ${[16, 19, 22, 25, 28].map((x) => `<line x1="${x}" y1="${x === 22 ? 27.4 : 25.6}" x2="${x}" y2="${x === 22 ? 29.6 : 27.8}" stroke="${INK}" stroke-width=".5"/>`).join('')}
      <rect x="19.6" y="19.5" width="4.8" height="4" fill="${SKIN}" stroke="${INK}" stroke-width=".5"/>
      <path d="M6.4 44 Q22 47 37.6 44 L37.8 46.4 Q22 49.4 6.2 46.4 Z" fill="${GOLD}" stroke="${INK}" stroke-width=".5"/>
      <circle cx="22" cy="47" r="1.4" fill="${alt}" stroke="${INK}" stroke-width=".4"/>`;
    // 소매와 손 (들고 있는 물건 쪽)
    const arm = (sx, sy, hx, hy) => `<path d="M${sx - 3} ${sy} Q${(sx + hx) / 2} ${(sy + hy) / 2 + 3} ${hx - 1.6} ${hy + 1.2} L${hx + 1.6} ${hy - 1.2} Q${(sx + hx) / 2 + 2} ${(sy + hy) / 2 - 2} ${sx + 2} ${sy - 2} Z" fill="${alt}" stroke="${INK}" stroke-width=".5"/>
      <circle cx="${hx}" cy="${hy}" r="1.7" fill="${SKIN}" stroke="${INK}" stroke-width=".45"/>`;
    const face = `
      <ellipse cx="22" cy="15" rx="5.4" ry="6.3" fill="${SKIN}" stroke="${INK}" stroke-width=".6"/>
      <path d="M19.3 14 h1.6 M23.1 14 h1.6" stroke="${INK}" stroke-width=".7" stroke-linecap="round"/>
      <path d="M22 14.6 L21.4 17 L22.4 17" fill="none" stroke="${INK}" stroke-width=".45"/>
      <path d="M20.6 18.6 Q22 19.3 23.4 18.6" fill="none" stroke="${RED_C}" stroke-width=".6" stroke-linecap="round"/>`;
    let hat = '', extra = '', hair = '';
    if (rank === 'K') {
      hair = `<path d="M16.4 13 Q15.6 20 18 22 L17.6 14 Z M27.6 13 Q28.4 20 26 22 L26.4 14 Z" fill="#8a5a2b" stroke="${INK}" stroke-width=".4"/>`;
      extra = `<path d="M17.2 17.2 Q22 27 26.8 17.2 Q24.5 19.6 22 19.8 Q19.5 19.6 17.2 17.2 Z" fill="#8a5a2b" stroke="${INK}" stroke-width=".5"/>
        <path d="M20.3 18.9 Q22 18.1 23.7 18.9" fill="none" stroke="${INK}" stroke-width=".5"/>
        <line x1="37" y1="2" x2="37" y2="42" stroke="#9aa3ad" stroke-width="1.7"/>
        <line x1="37" y1="2" x2="37" y2="42" stroke="${INK}" stroke-width=".35"/>
        <rect x="33.5" y="30.5" width="7" height="1.8" rx=".6" fill="${GOLD}" stroke="${INK}" stroke-width=".4"/>
        <circle cx="37" cy="44" r="1.3" fill="${GOLD}" stroke="${INK}" stroke-width=".4"/>
        ${arm(30, 28, 37, 34)}`;
      hat = `<path d="M15.6 10 L15.8 3 L18.6 6.4 L22 1.6 L25.4 6.4 L28.2 3 L28.4 10 Z" fill="${GOLD}" stroke="${INK}" stroke-width=".6"/>
        <rect x="15.6" y="8.6" width="12.8" height="2.4" fill="${main}" stroke="${INK}" stroke-width=".5"/>
        <circle cx="22" cy="4.8" r=".9" fill="${alt}"/><circle cx="18.2" cy="8" r=".6" fill="#fff"/><circle cx="25.8" cy="8" r=".6" fill="#fff"/>`;
    } else if (rank === 'Q') {
      hair = `<path d="M16.3 12 Q14 22 15.6 26 L18.4 24 Q16.8 18 17.6 13 Z M27.7 12 Q30 22 28.4 26 L25.6 24 Q27.2 18 26.4 13 Z" fill="#c98a2e" stroke="${INK}" stroke-width=".45"/>`;
      hat = `<path d="M17 10.4 L17.6 5.6 L19.8 7.6 L22 4 L24.2 7.6 L26.4 5.6 L27 10.4 Q22 8.6 17 10.4 Z" fill="${GOLD}" stroke="${INK}" stroke-width=".55"/>
        <circle cx="22" cy="6.6" r=".8" fill="${alt}"/>`;
      extra = `<path d="M34 22 Q31 31 31.6 40" fill="none" stroke="${GREEN_C}" stroke-width="1"/>
        <path d="M32.6 30 Q35.4 28.6 36 30.8 Q33.8 31.6 32.6 30 Z" fill="${GREEN_C}"/>
        ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="34" cy="19.6" rx="1.3" ry="2.1" transform="rotate(${a} 34 22)" fill="${RED_C}" stroke="${INK}" stroke-width=".35"/>`).join('')}
        <circle cx="34" cy="22" r="1.1" fill="${GOLD}"/>
        ${arm(28, 28, 32.4, 33)}`;
    } else {
      hair = `<path d="M16.5 12.6 Q16 18 17.6 19.4 L17.8 13 Z M27.5 12.6 Q28 18 26.4 19.4 L26.2 13 Z" fill="#5a3a1e" stroke="${INK}" stroke-width=".4"/>`;
      hat = `<path d="M14.6 11 Q15 4.2 22 4 Q29.6 4.2 30.4 9.8 L29.6 11 Z" fill="${main}" stroke="${INK}" stroke-width=".6"/>
        <rect x="15.2" y="9.6" width="14.6" height="1.8" fill="${GOLD}" stroke="${INK}" stroke-width=".45"/>
        <path d="M27.6 8 Q33 2 37.4 1.4 Q34 4.8 29 9" fill="${alt}" stroke="${INK}" stroke-width=".45"/>`;
      extra = `<line x1="7.5" y1="4" x2="7.5" y2="46" stroke="#8a5a2b" stroke-width="1.3"/>
        <path d="M7.5 .6 L9.4 4.6 L7.5 6 L5.6 4.6 Z" fill="#9aa3ad" stroke="${INK}" stroke-width=".4"/>
        <path d="M5.6 7.6 Q7.5 6.4 9.4 7.6 L9.4 9 Q7.5 8 5.6 9 Z" fill="${GOLD}" stroke="${INK}" stroke-width=".35"/>
        ${arm(15, 27, 7.6, 30)}`;
    }
    const pip = `<text x="3.4" y="9" font-size="7.5" font-family="Georgia, serif" fill="${sc}">${SYM[suit]}</text>`;
    return `<g>${robe}${hair}${face}${hat}${extra}${pip}</g>`;
  }
  function courtSVG(rank, suit) {
    const red = suit === 'H' || suit === 'D';
    const half = courtHalf(rank, suit);
    return `<svg class="art" viewBox="0 0 44 104" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect x=".5" y=".5" width="43" height="103" rx="1.5" fill="#fffdf6" stroke="${red ? RED_C : INK}" stroke-width=".8"/>
      <svg x=".5" y=".5" width="43" height="103" viewBox="0 0 44 104" preserveAspectRatio="none">
        ${half}<g transform="rotate(180 22 52)">${half}</g>
      </svg>
      <line x1="1" y1="52" x2="43" y2="52" stroke="${red ? RED_C : INK}" stroke-width=".6"/>
    </svg>`;
  }
  // 조커: 방울 달린 모자를 쓴 광대 (컬러 / 흑백)
  function jokerSVG(color) {
    const c = color ? [RED_C, GOLD, BLUE_C, GREEN_C] : [INK, '#fff', INK, '#fff'];
    const stroke = INK;
    // 마름모 무늬 옷 (몸통 밖으로 나간 부분은 카드 색으로 덮는다)
    const diamonds = [];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 6; k++) {
      const x = 2 + k * 8 + (r % 2 ? 4 : 0), y = 62 + r * 8;
      diamonds.push(`<path d="M${x} ${y - 4} L${x + 4} ${y} L${x} ${y + 4} L${x - 4} ${y} Z" fill="${c[(r + k) % 4]}" stroke="${stroke}" stroke-width=".4"/>`);
    }
    return `<svg class="art" viewBox="0 0 44 104" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      ${diamonds.join('')}
      <path d="M-2 50 L22 53 Q12 54 8 64 L6 100 L6 106 L-2 106 Z" fill="#fbf8f1"/>
      <path d="M46 50 L22 53 Q32 54 36 64 L38 100 L38 106 L46 106 Z" fill="#fbf8f1"/>
      <rect x="-2" y="100" width="48" height="6" fill="#fbf8f1"/>
      <path d="M6 100 L8 64 Q12 54 22 53 Q32 54 36 64 L38 100 Z" fill="none" stroke="${stroke}" stroke-width=".8"/>
      <path d="M8 58 L11 54 L14 58 L17 54 L20 58 L22 54 L24 58 L27 54 L30 58 L33 54 L36 58 Q22 64 8 58 Z" fill="#fff" stroke="${stroke}" stroke-width=".6"/>
      <ellipse cx="22" cy="44" rx="7.6" ry="9" fill="${color ? SKIN : '#fff'}" stroke="${stroke}" stroke-width=".7"/>
      <path d="M17.6 42 q1.4 -1.6 2.8 0 M23.6 42 q1.4 -1.6 2.8 0" fill="none" stroke="${INK}" stroke-width=".7" stroke-linecap="round"/>
      <path d="M17 47 Q22 53 27 47" fill="none" stroke="${color ? RED_C : INK}" stroke-width=".9" stroke-linecap="round"/>
      <circle cx="16.6" cy="46" r="1.5" fill="${color ? '#f2a2a2' : '#bbb'}"/><circle cx="27.4" cy="46" r="1.5" fill="${color ? '#f2a2a2' : '#bbb'}"/>
      <path d="M22 36 L22.8 39 L21.2 39 Z" fill="${INK}"/>
      <path d="M14 37 Q4 30 3 18 Q10 24 16 30 Z" fill="${c[0]}" stroke="${stroke}" stroke-width=".7"/>
      <path d="M16 33 Q16 16 22 8 Q28 16 28 33 Z" fill="${c[2]}" stroke="${stroke}" stroke-width=".7"/>
      <path d="M30 37 Q40 30 41 18 Q34 24 28 30 Z" fill="${c[3 % 4] === '#fff' ? INK : c[3]}" stroke="${stroke}" stroke-width=".7"/>
      <path d="M13.4 36.6 Q22 31 30.6 36.6 L30 39 Q22 34.4 14 39 Z" fill="${c[1] === '#fff' ? '#fff' : GOLD}" stroke="${stroke}" stroke-width=".6"/>
      <circle cx="3" cy="17" r="2.2" fill="${GOLD}" stroke="${stroke}" stroke-width=".6"/>
      <circle cx="22" cy="7" r="2.2" fill="${GOLD}" stroke="${stroke}" stroke-width=".6"/>
      <circle cx="41" cy="17" r="2.2" fill="${GOLD}" stroke="${stroke}" stroke-width=".6"/>
      <text x="22" y="24" text-anchor="middle" font-size="6" font-family="Georgia, serif" fill="${color ? GOLD : '#fff'}">★</text>
    </svg>`;
  }

  function cardEl(c, tag = 'div') {
    const el = document.createElement(tag);
    el.className = 'card';
    el.dataset.id = c.id;
    if (c.rank === 'JOKER') {
      const color = c.suit === 'CJ';
      el.classList.add('joker');
      if (color) el.classList.add('color', 'red');
      const idx = '<b>JOKER</b>';
      el.innerHTML = `<div class="idx tl">${idx}</div><div class="court">${jokerSVG(color)}</div><div class="idx br">${idx}</div>`;
      el.setAttribute('aria-label', color ? '컬러 조커' : '흑백 조커');
    } else {
      if (RED[c.suit]) el.classList.add('red');
      const s = SYM[c.suit];
      const idx = `<b>${c.rank}</b><s>${s}</s>`;
      const mid = ['J', 'Q', 'K'].includes(c.rank)
        ? `<div class="court">${courtSVG(c.rank, c.suit)}</div>`
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
    const nOpp = n - 1;
    opp.classList.toggle('many', nOpp >= 4);
    for (let i = 1; i < n; i++) {
      if (i > 1) {
        // 자리 사이 진행 방향 화살표 (왼쪽 → 오른쪽이 시계 방향)
        opp.insertAdjacentHTML('beforeend', `<span class="flow ${g.dir === 1 ? '' : 'rev'}" aria-hidden="true">›</span>`);
      }
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
      const shown = p.out ? 0 : Math.min(p.count, nOpp >= 4 ? 4 : 7);
      let fan = '';
      for (let k = 0; k < shown; k++) {
        const a = (k - (shown - 1) / 2) * 7;
        fan += `<i style="left:calc(50% - 9px + ${(k - (shown - 1) / 2) * 6}px);transform:rotate(${a}deg)"></i>`;
      }
      d.innerHTML = `<div class="nm">${p.bot ? '<span class="bot">BOT</span>' : ''}<span></span></div><div class="fan">${fan}</div><div class="cnt">${p.out ? '–' : p.count + '장'}</div>${badge}`;
      d.querySelector('.nm span:last-child').textContent = p.name;
      // 테이블을 둘러앉은 것처럼 가운데 자리는 위로, 바깥 자리는 아래로
      const off = Math.abs((i - 1) - (nOpp - 1) / 2);
      if (nOpp >= 3) d.style.marginTop = `${Math.round(off * off * 7)}px`;
      opp.appendChild(d);
    }

    // 상태 문구
    const cur = g.players.find((p) => p.id === g.turn);
    let st = '';
    if (g.finished) st = '게임 종료';
    else if (myTurn) st = '내 차례';
    else st = `${cur ? escapeHtml(cur.name) : ''}님 차례`;
    if (n > 2) st += `<span class="dir">· ${g.dir === 1 ? '시계 방향 ↻' : '반시계 방향 ↺'}</span>`;
    $('status').innerHTML = st;
    $('status').classList.toggle('mine', myTurn);
    $('ring').classList.toggle('ccw', g.dir !== 1);
    $('ring').hidden = n <= 2;
    $('game').classList.toggle('my-turn', myTurn);

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
      } else if (selRank) {
        el.classList.add('dim');
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
        else if (line.includes('방향 전환') && g.players.length > 2) bubble(g.dir === 1 ? '시계 방향 ↻' : '반시계 방향 ↺');
        else if (line.includes('한 번 더!')) bubble((line.match(/· ([^·]+? 한 번 더!)/) || [0, '한 번 더!'])[1]);
        else if (line.includes('등!')) bubble(line.replace(/!$/, ''));
      }
    }
    seenSeq = g.logSeq || 0;
    renderLog(g.log);
    anim = { prev: null, handRects: {} }; // 같은 변화로 애니메이션이 다시 나오지 않게
    placeTurnToken(g, me);

    // 결과
    if (g.finished && !shownResult) {
      shownResult = true;
      setTimeout(() => showResults(g, me, lobby), 900);
    }
  }

  // --- 차례 말: 지금 차례인 자리로 미끄러져 간다 ---
  function placeTurnToken(g, me) {
    const tok = $('turnToken');
    if (g.finished || $('game').hidden) { tok.hidden = true; return; }
    const target = g.turn === me ? $('meBar') : document.querySelector(`.opp[data-id="${g.turn}"]`);
    if (!target) { tok.hidden = true; return; }
    const r = target.getBoundingClientRect();
    tok.hidden = false;
    tok.textContent = g.turn === me ? '내 차례' : '차례';
    const x = r.left + r.width / 2;
    const y = g.turn === me ? r.top - 4 : r.bottom + 2;
    tok.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, ${g.turn === me ? '-100%' : '0'})`;
  }
  window.addEventListener('resize', () => { if (state && state.game) placeTurnToken(state.game, state.me); });

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
