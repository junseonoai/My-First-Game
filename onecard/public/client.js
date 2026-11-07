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
  let gameNo = 0;
  let wasMyTurn = false;
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
  const TIER_NAME = { silver: '실버', gold: '골드', platinum: '플래티넘', master: '마스터', grandmaster: '그랜드마스터' };
  const TIER_SHORT = { silver: '실버', gold: '골드', platinum: '플래', master: '마스터', grandmaster: '그마' };
  // 둘이 할 때는 1등·2등 대신 우승·패배
  const rankLabel = (rank, n) => n === 2 ? (rank === 1 ? '우승' : '패배') : `${rank}등`;
  // 등급 문장(紋章): 실버 방패 → 골드 방패 → 플래티넘 보석 → 마스터 큰 보석 → 그랜드마스터 왕관
  const TIER_ICON = {
    silver: '<path d="M8 1.5 14 4v4.2C14 11.6 11.4 14 8 15 4.6 14 2 11.6 2 8.2V4z"/><path d="M5 8.2h6" class="ln"/>',
    gold: '<path d="M8 1.5 14 4v4.2C14 11.6 11.4 14 8 15 4.6 14 2 11.6 2 8.2V4z"/><path d="M5 6.8h6M5 9.6h6" class="ln"/>',
    platinum: '<path d="M8 1.2 14 5v6L8 14.8 2 11V5z"/><path d="M8 1.2v13.6M2 5l6 3.6L14 5" class="ln"/>',
    master: '<path d="M4.5 2h7L15 6.2 8 15 1 6.2z"/><path d="M1 6.2h14M6 2 5 6.2 8 15l3-8.8L10 2" class="ln"/>',
    grandmaster: '<path d="M1.5 5.5 5 8.5 8 2.5l3 6 3.5-3-1.4 8H2.9z"/><circle cx="8" cy="2.2" r="1.3"/><circle cx="1.5" cy="5.2" r="1.1"/><circle cx="14.5" cy="5.2" r="1.1"/><path d="M3 12.4h10" class="ln"/>',
  };
  const tierIcon = (t) => `<svg class="ti" viewBox="0 0 16 16" aria-hidden="true">${TIER_ICON[t] || TIER_ICON.gold}</svg>`;
  const tierTag = (t, short) => `<span class="tier t-${t || 'gold'}">${tierIcon(t || 'gold')}<span>${(short ? TIER_SHORT : TIER_NAME)[t || 'gold']}</span></span>`;
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
  function bubble(text, kind = '') {
    const b = $('bubble');
    b.hidden = true; void b.offsetWidth;
    b.className = 'bubble' + (kind ? ' ' + kind : '');
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
  const artCache = {};
  const cached = (key, make) => artCache[key] || (artCache[key] = make());
  function courtSVG(rank, suit) { return cached(rank + suit, () => courtSVGRaw(rank, suit)); }
  function courtSVGRaw(rank, suit) {
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
  function jokerSVG(color) { return cached('joker' + color, () => jokerSVGRaw(color)); }
  function jokerSVGRaw(color) {
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
  window.oneCardUI = { tierTag: (t) => tierTag(t), cardEl: (c) => cardEl(c), reaction: () => ({ best: +store.get('onecard-best-ms') || 0 }) };
  function backEl() { const el = document.createElement('div'); el.className = 'card back'; return el; }

  // --- 날아가는 카드 ---
  const sysCalm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let reduceMotion = sysCalm || store.get('onecard-calm') === '1'; // 설정의 '애니메이션 줄이기'
  let vibrateOn = store.get('onecard-vibrate') !== '0';
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
    // 안전장치: 화면이 가려져 애니메이션이 멈춰도 카드가 계속 숨겨져 있지 않게 정해진 시간 뒤 마무리
    let ended = false;
    const finish = () => { if (ended) return; ended = true; el.remove(); if (onDone) onDone(); };
    anim.onfinish = finish;
    setTimeout(finish, delay + dur + 900);
  }
  // 바닥에 놓인 카드의 기울기 (카드마다 고정)
  const tilt = (id) => ((id * 47) % 21) - 10;
  const nudge = (id) => ((id * 13) % 9) - 4;
  // 바닥에서 그 카드가 실제로 놓이는 자리 (날아간 카드가 도착 뒤 움찔하지 않게)
  function pileSpot(id) {
    const r = $('pile').getBoundingClientRect();
    return { left: r.left + nudge(id), top: r.top + nudge(id * 3), width: r.width, height: r.height };
  }

  // --- 화면 그리기 ---  // --- 화면 그리기 ---
  // 안전장치: 그리다가 오류가 나면 애니메이션 상태를 비우고 한 번 더 그린다
  function render() {
    try { renderRaw(); } catch (e) {
      console.error('render error', e);
      anim = { prev: null, handRects: {} }; landing.clear(); localFlown.clear(); deal = null; selected = [];
      try { renderRaw(); } catch (e2) { console.error('render error again', e2); }
    }
  }
  function renderRaw() {
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
      if (m.bot) {
        li.insertAdjacentHTML('beforeend', tierTag(m.tier)); // 등급은 추가할 때 고른다
      }
      if (!m.online) li.insertAdjacentHTML('beforeend', '<span class="tag off">연결 끊김</span>');
      if (lobby.host === me && m.id !== me) {
        const k = document.createElement('button');
        k.className = 'kick-btn'; k.setAttribute('aria-label', `${m.name} 내보내기`);
        k.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.6"/><path d="M3.5 19.5c.8-3.4 3.4-5.3 6.5-5.3s5.7 1.9 6.5 5.3"/><path d="M16.5 10.5h5"/></svg><span>내보내기</span>';
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
    if (deal && Date.now() > deal.until) deal = null; // 혹시 연출이 끊겨도 카드가 계속 가려지지 않게
    const myTurn = g.turn === me && !g.finished && !deal; // 나눠 주는 동안은 아직 아무 차례도 아님

    // 상대: 내 다음 순서부터
    const opp = $('opponents');
    opp.innerHTML = '';
    const n = g.players.length;
    const nOpp = n - 1;
    opp.classList.toggle('many', nOpp >= 4);
    const nextId = n > 2 && !g.finished ? nextAlive(g) : null; // 셋 이상: 다음 차례인 사람 표시
    for (let i = 1; i < n; i++) {
      if (i > 1) {
        // 자리 사이 진행 방향 화살표 (왼쪽 → 오른쪽이 시계 방향)
        opp.insertAdjacentHTML('beforeend', `<span class="flow ${g.dir === 1 ? '' : 'rev'}" aria-hidden="true"><i>›</i><i>›</i></span>`);
      }
      const p = g.players[(myIdx + i) % n];
      const online = (lobby.members.find((m) => m.id === p.id) || {}).online;
      const d = document.createElement('div');
      const pc = deal ? deal.opp[p.id] || 0 : p.count; // 나눠 주는 중이면 받은 만큼만
      d.className = 'opp' + (p.id === g.turn && !g.finished && !deal ? ' turn' : '') + (p.id === nextId ? ' next' : '') + (p.out ? ' out' : '') + (pc === 1 && !deal ? ' warn' : '');
      let badge = '<div class="badge"></div>'; // 줄 높이를 늘 같게 (자리가 들썩이지 않게)
      if (p.rank) badge = `<div class="badge">${rankLabel(p.rank, n)}</div>`;
      else if (p.bankrupt) badge = '<div class="badge bad">파산</div>';
      else if (p.out) badge = '<div class="badge bad">나감</div>';
      else if (!online && !p.bot) badge = '<div class="badge bad">연결 끊김</div>';
      else if (g.oneCard === p.id) badge = '<div class="badge bad">원카드?</div>';
      d.dataset.id = p.id;
      const shown = p.out ? 0 : Math.min(pc, nOpp >= 4 ? 4 : 7);
      let fan = '';
      for (let k = 0; k < shown; k++) {
        const a = (k - (shown - 1) / 2) * 7;
        fan += `<i style="left:calc(50% - 9px + ${(k - (shown - 1) / 2) * 6}px);transform:rotate(${a}deg)"></i>`;
      }
      d.innerHTML = `${p.id === nextId ? '<span class="next-tag">다음</span>' : ''}<div class="nm">${p.bot ? `<span class="bot">${tierTag(p.tier, true)}</span>` : ''}<span class="pn"></span></div><div class="fan">${fan}</div><div class="cnt">${p.out ? '–' : pc + '장'}</div>${badge}`;
      d.querySelector('.nm .pn').textContent = p.name;
      // 테이블을 둘러앉은 것처럼 가운데 자리는 위로, 바깥 자리는 아래로
      const off = Math.abs((i - 1) - (nOpp - 1) / 2);
      if (nOpp >= 3) d.style.marginTop = `${Math.round(off * off * 7)}px`;
      opp.appendChild(d);
    }

    // 상태 문구
    const cur = g.players.find((p) => p.id === g.turn);
    let st = '';
    const selectingNow = myTurn && selected.length > 0;
    if (g.finished) st = '게임 종료';
    else if (deal) st = '카드를 나눠 주는 중…';
    else if (selectingNow) st = '같은 숫자를 더 골라 함께 내요';
    else if (myTurn) st = g.penalty > 0 ? '받아치거나 막거나, 먹으세요' : '낼 카드를 고르세요'; // 내 차례 표시는 아래 상자 탭에
    else st = `${cur ? escapeHtml(cur.name) : ''}님 차례`;
    $('status').innerHTML = st;
    // 셋 이상: 도는 방향을 가운데에 크게 (바뀌면 한 바퀴 돈다)
    const dirEl = $('dirChip');
    dirEl.hidden = n <= 2 || g.finished || !!deal;
    dirEl.className = 'dir-chip' + (g.dir === 1 ? '' : ' ccw');
    dirEl.innerHTML = `<i>${g.dir === 1 ? '↻' : '↺'}</i>${g.dir === 1 ? '시계 방향' : '반시계 방향'}`;
    if (anim.prev && anim.prev.dir !== g.dir && n > 2) { dirEl.classList.add('flip'); dirFlash(g.dir); }
    $('status').classList.toggle('mine', myTurn);
    $('ring').classList.toggle('ccw', g.dir !== 1);
    $('ring').hidden = n <= 2;
    $('game').classList.toggle('my-turn', myTurn);
    // 상자 탭: 내 차례면 크게, 아니면 누구 차례인지
    const tabName = cur ? cur.name : '';
    $('tabLabel').textContent = g.finished ? '게임 종료' : deal ? '준비 중' : myTurn ? '내 차례' : `${tabName}님 차례` + (nextId === me ? ' · 다음은 나' : '');
    updateTimer();
    // 내 차례가 막 시작되면 크게 알려 준다 (휴대폰은 짧게 진동)
    if (myTurn && !wasMyTurn && seenSeq) {
      turnCue();
      try { if (vibrateOn && navigator.vibrate) navigator.vibrate(40); } catch {}
    }
    wasMyTurn = myTurn;
    if (!myTurn && !$('suitModal').hidden) { $('suitModal').hidden = true; pendingSeven = null; } // 시간이 지나 차례가 넘어갔으면 무늬 고르기 창을 닫는다

    // 바닥: 최근 카드 몇 장이 살짝 비뚤게 쌓임. 새로 낸 카드는 낸 사람 자리에서 날아온다.
    const pile = $('pile');
    const recent = g.recent && g.recent.length ? g.recent : [g.top];
    const fresh = pileSeen.size ? recent.filter((c) => !pileSeen.has(c.id)) : [];
    pile.innerHTML = '';
    for (const c of recent) {
      const el = cardEl(c);
      el.style.transform = `translate(${nudge(c.id)}px, ${nudge(c.id * 3)}px) rotate(${tilt(c.id)}deg)`;
      // 날아오는 중인 카드는 도착할 때까지 숨긴다 (내가 이미 날린 카드는 도착했으면 바로 보임)
      if (landing.has(c.id) || (fresh.includes(c) && !localFlown.has(c.id))) el.style.visibility = 'hidden';
      pile.appendChild(el);
    }
    const actor = anim.prev ? anim.prev.turn : null;
    fresh.forEach((c, i) => {
      if (localFlown.has(c.id)) { localFlown.delete(c.id); return; } // 이미 날아가는 중이거나 도착함
      landing.add(c.id);
      let from = null;
      if (actor === me) from = anim.handRects[c.id] || $('hand').getBoundingClientRect();
      else { const seat = document.querySelector(`.opp[data-id="${actor}"] .fan`); from = seat && seat.getBoundingClientRect(); }
      fly(() => cardEl(c), from, pileSpot(c.id), {
        delay: i * 110, rotFrom: actor === me ? 0 : -20, rotTo: tilt(c.id),
        onDone: () => {
          landing.delete(c.id);
          const el = pile.querySelector(`.card[data-id="${c.id}"]`);
          if (el) el.style.visibility = '';
        },
      });
    });
    // 지금 바닥에 보이는 카드만 기억한다: 덱을 다시 섞은 뒤 같은 카드가 또 나와도 새 카드로 알아보게
    pileSeen.clear();
    for (const c of recent) pileSeen.add(c.id);
    // 내가 날린 카드는 손패에서 빠졌으면 정리 (남아 있으면 나중에 그 카드를 다시 받았을 때 안 보인다)
    for (const id of [...localFlown]) if (!g.hand.some((c) => c.id === id)) localFlown.delete(id);
    pile.style.visibility = deal && !deal.pile ? 'hidden' : '';
    $('deck').style.visibility = deal && !deal.deck ? 'hidden' : '';
    $('deckCount').style.visibility = deal && !deal.deck ? 'hidden' : '';

    const badge = $('suitBadge');
    const showSuit = g.activeSuit && (g.top.rank === 'JOKER' || g.activeSuit !== g.top.suit);
    badge.textContent = showSuit ? SYM[g.activeSuit] : (g.top.rank === 'JOKER' && !g.activeSuit && g.penalty === 0 ? '★' : '');
    badge.className = 'suit-badge' + (showSuit && RED[g.activeSuit] ? ' red' : '');
    $('deckCount').textContent = `남은 카드 ${deal ? deckLeft() : g.deckCount}`;
    if (deal && !deal.pile) badge.textContent = '';
    $('deck').classList.toggle('can', myTurn);

    // 쌓인 공격 장수: 많을수록 더 크게, 더 격하게
    renderStack(g.finished ? 0 : g.penalty);

    // 버튼
    const meP = g.players[myIdx];
    $('btnDraw').disabled = !myTurn;
    $('btnDraw').textContent = g.penalty > 0 && myTurn ? `${g.penalty}장 먹기` : '카드 뽑기';
    $('btnDraw').classList.toggle('danger', g.penalty > 0 && myTurn);

    // 원카드 선착순 팝업
    renderOnePop();

    // 내 이름/타이머
    $('myName').textContent = (meP ? meP.name : '') + ` · ${deal ? deal.mine : g.hand.length}장` + (meP && meP.rank ? ` · ${rankLabel(meP.rank, n)}` : '') + (meP && meP.bankrupt ? ' · 파산' : '');
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
    const sorted = sortCards(g.hand);
    const rows = layoutHand(hand, sorted.length);
    sorted.forEach((c, idx) => {
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
      if (newHandIds.has(c.id) || localFlown.has(c.id) || (deal && idx >= deal.mine)) el.style.visibility = 'hidden';
      rows[idx < rows.per ? 0 : 1].appendChild(el);
    });
    animateDraws(g, me);
    slideHand(anim.handRects);
    const selecting = selected.length > 0;
    $('btnMulti').hidden = !selecting;
    $('btnMultiCancel').hidden = !selecting;
    $('btnDraw').hidden = selecting;
    $('multiHint').hidden = true; // 안내는 위 상태 줄에 (자리가 밀리지 않게)
    $('btnMulti').textContent = `${selected.length}장 내기`;

    // 기록
    const newCount = Math.min((g.logSeq || 0) - seenSeq, g.log.length);
    if (seenSeq && newCount > 0) {
      for (const line of g.log.slice(-newCount)) {
        if (line.includes('원카드!') || line.includes('벌칙')) continue; // 원카드 결과는 결과 창에서
        if (line.includes('파산')) bubble('파산');
        else if (line.includes('막기')) bubble('막기!');
        else if (line.includes('한 번 더!')) bubble((line.match(/· ([^·]+? 한 번 더!)/) || [0, '한 번 더!'])[1]);
        else if (line.includes('등!') || line.includes('우승!')) bubble(line.replace(/!$/, ''));
      }
    }
    seenSeq = g.logSeq || 0;
    renderLog(g.log);
    anim = { prev: null, handRects: {} }; // 같은 변화로 애니메이션이 다시 나오지 않게
    placeTurnToken(g, me);

    // 방장이 나가서 바뀌면 결과 창의 '다시 하기'도 새 방장에게
    if (!$('resultModal').hidden) $('btnAgain').hidden = lobby.host !== me;

    // 결과
    if (g.finished && !shownResult) {
      shownResult = true;
      setTimeout(() => showResults(g, me, lobby), 900);
    }
  }

  // 다음 차례인 사람 (지금 방향으로 한 칸)
  function nextAlive(g) {
    const n = g.players.length;
    let t = g.players.findIndex((p) => p.id === g.turn);
    for (let k = 0; k < n; k++) {
      t = (t + g.dir + n) % n;
      if (!g.players[t].out) return g.players[t].id;
    }
    return null;
  }

  // 방향이 바뀌면 가운데에 큰 화살표가 돈다
  function dirFlash(dir) {
    const el = document.createElement('div');
    el.className = 'dir-flash' + (dir === 1 ? '' : ' ccw');
    el.innerHTML = `<i>${dir === 1 ? '↻' : '↺'}</i><b>${dir === 1 ? '시계 방향' : '반시계 방향'}</b>`;
    const r = $('pile').getBoundingClientRect();
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  // 카드를 받으면 받은 사람 자리에 '+N장'이 크게 뜬다 (공격을 먹으면 빨갛게)
  function drawMark(id, n, me) {
    const anchor = id === me ? $('trayTab') : document.querySelector(`.opp[data-id="${id}"]`);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'draw-mark' + (n >= 2 ? ' big' : '') + (id === me ? ' mine' : '');
    el.innerHTML = `<b>+${n}</b>장${n >= 2 ? ' 먹음' : ''}`;
    el.style.left = Math.min(Math.max(r.left + r.width / 2, 50), window.innerWidth - 50) + 'px';
    el.style.top = (id === me ? r.top - 10 : r.top + r.height * .45) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // --- 게임 시작 연출 ---
  // 단색 배경에서 먼저 할 사람 고르기(둘이면 칩 던지기, 셋 이상이면 룰렛) → 덱이 나타남
  // → 덱에서 한 장씩 나눠 줌 → 시작 카드 한 장을 바닥에 → 누가 먼저인지 알림
  // 서버(INTRO_MS = 7600)는 이 시간 동안 판을 멈춰 둔다.
  const PICK_SPIN = 2500, PICK_SHOW = 900, DECK_IN = 450, DEAL_MS = 2100, START_CARD = 650;
  const introDone = new Set();
  let introTimers = [];
  let deal = null; // 나눠 주는 중: { mine, opp: {id: n}, deck, pile, total, given }
  const later = (ms, fn) => introTimers.push(setTimeout(fn, ms));
  const nameOf = (g, id, me) => { const p = g.players.find((x) => x.id === id); return p ? (id === me ? '나' : p.name) : '?'; };

  // 새 게임 상태가 들어올 때 (화면을 그리기 전에) 연출을 준비한다
  function maybeStartIntro(s) {
    const it = s.intro;
    if (!it || !s.game) return;
    const key = s.lobby.code + ':' + it.id;
    if (introDone.has(key)) return;
    introDone.add(key);
    introTimers.forEach(clearTimeout); introTimers = [];
    const full = PICK_SPIN + PICK_SHOW + DECK_IN + DEAL_MS + START_CARD;
    if (reduceMotion || it.left < full - 800) { deal = null; return; } // 중간에 들어왔으면 건너뛴다
    const opp = {};
    for (const p of s.game.players) opp[p.id] = 0;
    deal = { mine: 0, opp, deck: false, pile: false, total: s.game.players.length * 7, given: 0, until: Date.now() + full + 1500 };
    playPick(it, s.game, s.me);
    later(PICK_SPIN + PICK_SHOW, () => { $('introPop').hidden = true; showDeck(); });
    later(PICK_SPIN + PICK_SHOW + DECK_IN, () => dealCards(s.me));
    later(PICK_SPIN + PICK_SHOW + DECK_IN + DEAL_MS, () => placeStartCard());
    later(full, () => {
      const g = state && state.game;
      deal = null;
      render();
      if (g) bubble(g.turn === state.me ? '내가 먼저 시작!' : `${nameOf(g, g.turn, state.me)}님부터 시작!`, 'start');
    });
  }

  // 1) 먼저 할 사람 고르기 (단색 배경)
  function playPick(it, g, me) {
    const pop = $('introPop'), stage = $('introStage');
    pop.hidden = false;
    pop.className = 'intro-pop k-' + it.kind;
    $('introMsg').textContent = '';
    const starterIdx = Math.max(0, it.order.indexOf(it.starter));
    if (it.kind === 'coin') {
      $('introTitle').textContent = '칩 던지기 · 누가 먼저?';
      stage.innerHTML = `<div class="chip3d">${Array.from({ length: 19 }, (_, k) => k - 9).map((z) => `<i class="rim" style="transform:translateZ(${z}px)"></i>`).join('')}<div class="face a"><div class="chip-in"><small>앞</small><span></span></div></div><div class="face b"><div class="chip-in"><small>뒤</small><span></span></div></div></div><div class="chip-shadow"></div>`;
      stage.querySelector('.face.a span').textContent = nameOf(g, it.order[0], me);
      stage.querySelector('.face.b span').textContent = nameOf(g, it.order[1], me);
      const end = 360 * 6 + (starterIdx === 1 ? 180 : 0);
      stage.querySelector('.chip3d').animate([
        { transform: 'translateY(0) rotateX(0deg) scale(1)' },
        { transform: `translateY(-120px) rotateX(${end * .55}deg) scale(1.15)`, offset: .45 },
        { transform: `translateY(0) rotateX(${end - 20}deg) scale(1)`, offset: .85 },
        { transform: `translateY(0) rotateX(${end}deg) scale(1)` },
      ], { duration: PICK_SPIN, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' });
      stage.querySelector('.chip-shadow').animate([{ transform: 'scale(1)', opacity: .5 }, { transform: 'scale(.5)', opacity: .2, offset: .45 }, { transform: 'scale(1)', opacity: .5 }], { duration: PICK_SPIN * .85, fill: 'forwards' });
    } else {
      $('introTitle').textContent = '룰렛 · 누가 먼저?';
      const n = it.order.length, seg = 360 / n, R = 100;
      // 칩과 같은 색: 빨강 · 먹색 · 크림을 번갈아 (마지막 칸이 첫 칸과 같은 색이면 금색)
      const FILL = ['#b3262e', '#1f1a14', '#f3ead6'];
      const fillOf = (i) => (i === n - 1 && n % 3 === 1 ? '#d9ab3c' : FILL[i % 3]);
      const pt = (a, r) => [120 + r * Math.sin(a * Math.PI / 180), 120 - r * Math.cos(a * Math.PI / 180)];
      let svg = '';
      it.order.forEach((id, i) => {
        const [x1, y1] = pt(i * seg, R), [x2, y2] = pt((i + 1) * seg, R);
        const mid = (i + .5) * seg, [tx, ty] = pt(mid, R * .6);
        const f = fillOf(i), light = f === '#f3ead6' || f === '#d9ab3c';
        svg += `<path d="M120 120 L${x1} ${y1} A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x2} ${y2} Z" fill="${f}" stroke="#1f1a14" stroke-width="2.5" data-i="${i}"/>`;
        svg += `<text x="${tx}" y="${ty}" transform="rotate(${mid} ${tx} ${ty})" text-anchor="middle" dominant-baseline="middle" font-size="${n >= 5 ? 13 : 15}" font-weight="700" fill="${light ? '#1f1a14' : '#f3ead6'}">${escapeHtml(nameOf(g, id, me).slice(0, 6))}</text>`;
      });
      // 바깥 테두리는 칩 가장자리처럼 줄무늬
      stage.innerHTML = `<div class="wheel-pin"></div><svg class="wheel" viewBox="0 0 240 240">
        <circle cx="120" cy="120" r="116" fill="#b3262e" stroke="#1f1a14" stroke-width="3"/>
        <circle cx="120" cy="120" r="108" fill="none" stroke="#f3ead6" stroke-width="10" stroke-dasharray="14 14"/>
        <g class="wheel-in">${svg}</g>
        <circle cx="120" cy="120" r="101" fill="none" stroke="#1f1a14" stroke-width="3"/>
        <circle cx="120" cy="120" r="20" fill="#d9ab3c" stroke="#1f1a14" stroke-width="3"/>
        <circle cx="120" cy="120" r="12" fill="none" stroke="#1f1a14" stroke-width="1.5" stroke-dasharray="3 3"/></svg>`;
      const jitter = (Math.random() - .5) * seg * .6;
      const end = 360 * 5 + (360 - (starterIdx + .5) * seg) + jitter; // 고른 칸이 위쪽 바늘에 멈춘다
      stage.querySelector('.wheel').animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${end}deg)` }],
        { duration: PICK_SPIN, easing: 'cubic-bezier(.12,.6,.15,1)', fill: 'forwards' });
      // 걸린 칸: 이웃 칸과 테두리에 가려지지 않게 윤곽선만 따로 맨 위에 (안쪽으로 고르게)
      later(PICK_SPIN, () => {
        const seg0 = stage.querySelector(`path[data-i="${starterIdx}"]`);
        const hub = stage.querySelector('.wheel > circle[r="20"]');
        if (!seg0 || !hub) return;
        const hl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hl.setAttribute('d', seg0.getAttribute('d'));
        hl.setAttribute('class', 'win-line');
        hub.before(hl);
      });
    }
    later(PICK_SPIN, () => {
      pop.classList.add('reveal');
      $('introMsg').textContent = it.starter === me ? '내가 먼저!' : `${nameOf(g, it.starter, me)}님이 먼저!`;
    });
  }

  // 2) 덱이 먼저 나타난다
  function showDeck() {
    if (!deal) return;
    deal.deck = true;
    render();
    $('deck').animate([{ transform: 'translateY(-30px) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.3,1.4,.5,1)' });
  }

  // 3) 덱에서 한 사람씩 돌아가며 7장씩 나눠 준다
  function dealCards(me) {
    const g = state && state.game;
    if (!deal || !g) return;
    const myIdx = g.players.findIndex((p) => p.id === me);
    const order = g.players.map((_, k) => g.players[(myIdx + 1 + k) % g.players.length].id); // 내 다음 사람부터, 나는 마지막
    const gap = (DEAL_MS - 380) / deal.total;
    let k = 0;
    for (let round = 0; round < 7; round++) {
      for (const id of order) {
        const at = k++ * gap;
        later(at, () => dealOne(id, me));
      }
    }
  }
  function dealOne(id, me) {
    if (!deal) return;
    const deck = $('deck').getBoundingClientRect();
    deal.given++;
    $('deckCount').textContent = `남은 카드 ${deckLeft()}`;
    const land = () => { if (!deal) return; if (id === me) deal.mine++; else deal.opp[id]++; render(); };
    if (id === me) {
      const el = document.querySelectorAll('#hand .card')[deal.mine];
      if (!el) return land();
      fly(backEl, deck, el.getBoundingClientRect(), { dur: 360, rotFrom: -8, onDone: land });
    } else {
      const seat = document.querySelector(`.opp[data-id="${id}"] .fan`);
      if (!seat) return land();
      const r = seat.getBoundingClientRect();
      const to = { left: r.left + r.width / 2 - deck.width / 2, top: r.top + r.height / 2 - deck.height / 2, width: deck.width, height: deck.height };
      fly(backEl, deck, to, { dur: 360, rotTo: 12, endScale: .3, onDone: land });
    }
  }
  const deckLeft = () => (state && state.game ? state.game.deckCount : 0) + (deal ? deal.total - deal.given + (deal.pile ? 0 : 1) : 0);

  // 4) 덱에서 시작 카드 한 장을 뒤집어 바닥에
  function placeStartCard() {
    const g = state && state.game;
    if (!deal || !g) return;
    const c = g.top;
    fly(backEl, $('deck').getBoundingClientRect(), pileSpot(c.id), {
      dur: 420, rotTo: tilt(c.id),
      onDone: () => {
        if (!deal) return;
        deal.pile = true;
        render();
        const el = $('pile').querySelector(`.card[data-id="${c.id}"]`);
        if (el) el.animate([{ transform: el.style.transform + ' rotateY(90deg)' }, { transform: el.style.transform }], { duration: 220, easing: 'ease-out' });
      },
    });
  }

  // 내 차례가 시작될 때: 손패 위에 '내 차례' 띠가 올라왔다 사라진다
  function turnCue() {
    const el = $('trayTab');
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }

  // --- 원카드: 카운트다운 → 버튼 열림(2초) → 누르면 내 기록 → 모두 눌렀거나 2초 지나면 전체 결과, 판 재개 ---
  let raceSeen = {}; // race.id → { openAt, closeAt, doneAt, resumeAt }
  const counted = new Set(); // 최고 기록에 이미 반영한 경쟁
  let myPress = {}; // race.id → { ms, place } (서버가 바로 알려 줌)
  let oneTicker = null;
  let guardUntil = 0; // 결과가 뜬 직후 실수로 카드 뽑기를 누르지 않게
  function raceInfo(race) {
    let r = raceSeen[race.id];
    if (!r) r = raceSeen[race.id] = { openAt: Date.now() + race.openIn, closeAt: Date.now() + race.closeIn, doneAt: 0 };
    if (race.done && !r.doneAt) {
      r.doneAt = Date.now();
      r.resumeAt = r.doneAt + (race.resumeIn != null ? race.resumeIn : 1200); // 결과를 보여 준 뒤 다 함께 재개
      guardUntil = r.resumeAt + 300;
    }
    return r;
  }
  function onePhase() {
    const g = state && state.game;
    const race = state && state.race;
    if (!g || !race) return null;
    const info = raceInfo(race);
    const now = Date.now();
    if (race.done) return now < info.resumeAt ? 'result' : null;
    if (now > info.closeAt + 4000) return null; // 안전장치: 결과가 오지 않아도 화면을 계속 막지 않는다
    const me = state.me;
    const eligible = race.eligible.some((e) => e.id === me);
    if (!eligible) return 'watch';
    if (myPress[race.id] || race.presses.some((p) => p.id === me)) return 'mine';
    return now < info.openAt ? 'count' : 'open';
  }
  function renderOnePop() {
    const phase = onePhase();
    const pop = $('onePop');
    pop.hidden = !phase; // 결과를 보는 동안에도 판은 멈춰 있으니 뒤를 막는다
    pop.className = 'one-pop' + (phase ? ' ' + phase : '');
    $('racePanel').hidden = phase !== 'result';
    clearInterval(oneTicker); oneTicker = null;
    if (!phase) return;
    const race = state.race, me = state.me;
    const info = raceInfo(race);
    pop.classList.toggle('mine-target', race.target === me);
    const btn = $('btnOne');
    const bar = $('oneBar');
    const now = Date.now();
    if (phase === 'count') {
      btn.textContent = Math.ceil((info.openAt - now) / 1000);
      btn.disabled = true;
      $('oneMsg').textContent = race.target === me ? '한 장 남았어요! 준비…' : `${race.targetName}님이 한 장! 준비…`;
    } else if (phase === 'open') {
      btn.textContent = '원카드!';
      btn.disabled = false;
      $('oneMsg').textContent = race.target === me ? '지금! 먼저 누르세요' : '지금! 먼저 누르면 벌칙';
      bar.style.transform = `scaleX(${Math.max(0, (info.closeAt - now) / 2000)})`;
    } else if (phase === 'mine') {
      const mine = myPress[race.id] || race.presses.find((p) => p.id === me);
      btn.disabled = true;
      btn.textContent = mine ? `${(mine.ms / 1000).toFixed(2)}초` : '…';
      const place = mine && (mine.place || race.presses.findIndex((p) => p.id === me) + 1);
      $('oneMsg').textContent = place === 1 ? '가장 빨랐어요! 다른 사람 기다리는 중…' : `${place}번째로 눌렀어요. 다른 사람 기다리는 중…`;
      bar.style.transform = `scaleX(${Math.max(0, (info.closeAt - now) / 2000)})`;
    } else if (phase === 'watch') {
      btn.disabled = true;
      btn.textContent = now < info.openAt ? Math.ceil((info.openAt - now) / 1000) : '…';
      $('oneMsg').textContent = `${race.targetName}님 원카드 상황`;
    } else if (phase === 'result') {
      renderRace(race, me);
    }
    // 카운트다운·남은 시간·결과 시간이 흐르는 동안 다시 그린다
    oneTicker = setInterval(() => {
      const ph = onePhase();
      if (ph !== phase || ph === 'count' || ph === 'open' || ph === 'mine' || ph === 'watch') renderOnePop();
      if (!ph && phase === 'result') render(); // 재개: 막아 두었던 화면을 다시 그린다
    }, 80);
  }

  // 전체 결과: 누른 사람은 시간 순서, 안 누른 사람은 실패. 판은 이미 다시 움직인다 (화면을 막지 않음)
  let raceDrawn = '';
  function renderRace(race, me) {
    const el = $('racePanel');
    const drawn = gameNo + ':' + race.id + ':' + race.presses.length;
    if (drawn === raceDrawn) return;
    raceDrawn = drawn;
    const rows = race.presses.slice().sort((a, b) => a.ms - b.ms);
    const failed = race.eligible.filter((e) => !race.presses.some((p) => p.id === e.id));
    const mine = race.presses.find((p) => p.id === me);
    let best = +store.get('onecard-best-ms') || 0, record = '';
    if (mine && !counted.has(gameNo + ':' + race.id)) {
      counted.add(gameNo + ':' + race.id);
      if (!best || mine.ms < best) { record = best ? ' · 새 기록!' : ''; best = mine.ms; store.set('onecard-best-ms', mine.ms); }
    }
    const winner = race.presses.find((p) => p.first);
    const who = (id, name) => (id === me ? '내가' : `${name}님이`);
    const [head, cls, sub] = !winner ? ['벌칙 없음', 'none', '아무도 누르지 않았어요']
      : winner.id === race.target ? ['원카드 성공!', 'ok', `${who(winner.id, winner.name)} 먼저 눌렀어요`]
      : ['벌칙 1장', 'bad', `${who(winner.id, winner.name)} 먼저! ${race.target === me ? '내가' : race.targetName + '님이'} 1장 받아요`];
    el.innerHTML = `<div class="race-stamp ${cls}"></div><div class="race-out"></div><ol></ol>${best ? `<div class="race-best">내 최고 ${(best / 1000).toFixed(2)}초${record}</div>` : ''}`;
    el.querySelector('.race-stamp').textContent = head;
    el.querySelector('.race-out').textContent = sub;
    const ol = el.querySelector('ol');
    rows.forEach((p, k) => {
      const li = document.createElement('li');
      if (p.id === me) li.className = 'me';
      li.innerHTML = `<span class="rn"></span><b>${(p.ms / 1000).toFixed(2)}초</b><i>${k === 0 ? '먼저!' : k + 1 + '등'}</i>`;
      li.querySelector('.rn').textContent = p.name + (p.id === me ? ' (나)' : '');
      ol.appendChild(li);
    });
    for (const f of failed) {
      const li = document.createElement('li');
      li.className = 'fail' + (f.id === me ? ' me' : '');
      li.innerHTML = '<span class="rn"></span><b>–</b><i>실패</i>';
      li.querySelector('.rn').textContent = f.name + (f.id === me ? ' (나)' : '');
      ol.appendChild(li);
    }
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  // --- 차례 말: 지금 차례인 자리로 미끄러져 간다 ---
  function placeTurnToken(g, me) {
    const tok = $('turnToken');
    if (g.finished || $('game').hidden || deal) { tok.hidden = true; return; }
    // 내 차례는 가운데 표시·내 이름 줄·손패 테두리로 알리므로 말은 상대 차례에만
    const target = g.turn === me ? null : document.querySelector(`.opp[data-id="${g.turn}"]`);
    if (!target) { tok.hidden = true; return; }
    const r = target.getBoundingClientRect();
    tok.hidden = false;
    tok.textContent = tokenText();
    const x = r.left + r.width / 2;
    const y = g.turn === me ? r.top - 4 : r.bottom - 9; // 자리 아랫변에 걸쳐서 (가운데 글자를 가리지 않게)
    tok.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, ${g.turn === me ? '-100%' : '0'})`;
  }
  window.addEventListener('resize', () => { if (state && state.game) placeTurnToken(state.game, state.me); });

  // 손패 재배치: 예전 자리에서 새 자리로 미끄러진다
  function slideHand(oldRects) {
    if (reduceMotion || !oldRects) return;
    document.querySelectorAll('#hand .card').forEach((el) => {
      const old = oldRects[el.dataset.id];
      if (!old || el.style.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      const dx = old.left - r.left, dy = old.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) < 2) return;
      el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: 260, easing: 'cubic-bezier(.25,.8,.3,1)' });
    });
  }

  // --- 카드 뽑기 애니메이션: 덱에서 받은 사람에게 ---
  function animateDraws(g, me) {
    const prev = anim.prev;
    if (!prev) return;
    const deck = $('deck').getBoundingClientRect();
    for (const p of g.players) {
      const before = prev.players.find((x) => x.id === p.id);
      if (!before || p.out) continue;
      const got = p.count - before.count;
      const delta = Math.min(got, 6);
      if (delta <= 0) continue;
      drawMark(p.id, got, me);
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

  // 손패 배치: 한 줄에 다 안 들어가면 두 줄로 나누고, 그래도 넘치면 더 겹친다
  function layoutHand(hand, n) {
    const mobile = window.innerWidth <= 520;
    const cw = mobile ? 62 : 84;
    const normalStep = cw - (mobile ? 24 : 32);
    const avail = Math.max(cw, hand.clientWidth - 24);
    const cap = Math.max(1, Math.floor((avail - cw) / normalStep) + 1);
    const two = n > cap;
    const per = two ? Math.ceil(n / 2) : n;
    const step = per > 1 ? Math.min(normalStep, (avail - cw) / (per - 1)) : normalStep;
    hand.classList.toggle('two', two);
    const mk = () => { const r = document.createElement('div'); r.className = 'hand-row'; r.style.setProperty('--ov', `${step - cw}px`); hand.appendChild(r); return r; };
    const rows = two ? [mk(), mk()] : [mk()];
    rows.per = per;
    return rows;
  }
  window.addEventListener('resize', () => { if (state && state.game && !$('game').hidden) render(); });

  // --- 손패 정렬 ---
  const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'];
  const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3, BJ: 4, CJ: 5 };
  let sortMode = store.get('onecard-sort') === 'rank' ? 'rank' : 'suit';
  function sortCards(hand) {
    const bySuit = (a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    const byRank = (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
    return hand.slice().sort(sortMode === 'rank' ? (a, b) => byRank(a, b) || bySuit(a, b) : (a, b) => bySuit(a, b) || byRank(a, b));
  }
  function updateSortBtn() { $('sortLabel').textContent = sortMode === 'rank' ? '숫자순' : '모양순'; }
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
      if (n > lastPenalty) {
        el._bump = true;
        clearTimeout(el._t); el._t = setTimeout(() => { el._bump = false; el.classList.remove('bump'); }, 360);
      }
      el.className = 'stack lv' + lv + (el._bump ? ' bump' : '');
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
      const duel = list.length === 2;
      const mark = duel ? (p.rank === 1 ? '승' : '패') : (p.rank || '–');
      const note = p.bankrupt ? '파산' : !p.rank ? '나감' : duel ? rankLabel(p.rank, 2) : '';
      li.innerHTML = `<span class="pl">${mark}</span><span class="n"></span><span class="note${duel && p.rank === 1 ? ' win' : ''}">${note}</span>`;
      li.querySelector('.n').textContent = p.name + (p.id === me ? ' (나)' : '');
      if (p.bot) li.querySelector('.n').insertAdjacentHTML('afterend', tierTag(p.tier));
      ol.appendChild(li);
    }
    const isHost = state.lobby.host === me;
    $('btnAgain').hidden = !isHost;
    const mine = g.players.find((p) => p.id === me);
    $('resultTitle').textContent = list.length === 2 ? (mine && mine.rank === 1 ? '우승!' : '패배') : '게임 결과';
    $('resultModal').hidden = false;
  }

  function playCard(c, playable, g) {
    if (!tableFree()) return;
    if (localFlown.size || Date.now() < actBusyUntil) return; // 방금 낸 카드의 답을 기다리는 중 (두 번 눌림 방지)
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

  // 내가 낸 카드는 서버 응답을 기다리지 않고 바로 바닥으로 날린다
  const localFlown = new Set();
  function launchLocal(ids) {
    if (reduceMotion) return;
    // 남은 카드는 바로 빈자리를 메운다 (서버 응답 뒤에 따로 움직이지 않게)
    const before = {};
    document.querySelectorAll('#hand .card').forEach((el) => { before[el.dataset.id] = el.getBoundingClientRect(); });
    const gone = [];
    ids.forEach((id, i) => {
      const el = document.querySelector(`#hand .card[data-id="${id}"]`);
      const c = state && state.game && state.game.hand.find((x) => x.id === id);
      if (!el || !c) return;
      const from = el.getBoundingClientRect();
      gone.push(el);
      localFlown.add(id);
      landing.add(id);
      fly(() => cardEl(c), from, pileSpot(id), {
        delay: i * 110, rotTo: tilt(id),
        onDone: () => {
          landing.delete(id);
          const pe = $('pile').querySelector(`.card[data-id="${id}"]`);
          if (pe) pe.style.visibility = '';
        },
      });
    });
    gone.forEach((el) => el.remove());
    slideHand(before);
  }
  function emitPlay(ids, suit) {
    actBusyUntil = Date.now() + 1500;
    launchLocal(ids);
    // 안전장치: 3초가 지나도 서버가 받지 않았으면(연결 문제) 카드를 손으로 돌려놓는다
    setTimeout(() => {
      const hand = state && state.game ? state.game.hand : [];
      const stuck = ids.filter((id) => localFlown.has(id) && hand.some((c) => c.id === id));
      if (stuck.length) { stuck.forEach((id) => { localFlown.delete(id); landing.delete(id); }); render(); }
    }, 3000);
    socket.emit('play', suit ? { cardIds: ids, suit } : { cardIds: ids });
  }

  function submitPlay(ids, g) {
    const first = g.hand.find((x) => x.id === ids[0]);
    if (first && first.rank === '7' && g.penalty === 0) {
      pendingSeven = ids;
      $('suitModal').hidden = false;
      return;
    }
    emitPlay(ids);
    selected = [];
  }

  // --- 타이머 표시: 내 차례면 이름 줄의 초와 손패 위 시간 막대 ---
  // 상대 차례: 사람이면 남은 초를 차례 표시에 함께 (봇은 금방 내므로 표시하지 않음)
  function tokenText() {
    const g = state && state.game;
    if (!g || g.finished || deal || g.turn === state.me || !state.localDeadline) return '차례';
    return '차례';
  }
  function updateTimer() {
    const tok = $('turnToken');
    if (!tok.hidden) {
      const txt = tokenText();
      if (tok.textContent !== txt) tok.textContent = txt;
      const g = state && state.game;
      // 상대(사람) 차례면 '차례' 뒤 배경이 남은 시간만큼 줄어드는 막대가 된다
      const timed = g && !g.finished && !deal && g.turn !== state.me && state.localDeadline;
      const left = timed ? Math.max(0, state.localDeadline - Date.now()) / 1000 : 99;
      tok.classList.toggle('timed', !!timed);
      tok.classList.toggle('low', left <= 10);
      if (timed) tok.style.setProperty('--p', `${Math.min(100, left / 30 * 100).toFixed(1)}%`);
    }
    const t = $('tabTime');
    const bar = $('turnBar');
    const g = state && state.game;
    const mine = g && !g.finished && !deal && g.turn === state.me && state.localDeadline;
    if (!mine) { t.textContent = ''; bar.hidden = false; bar.classList.add('off'); $('trayTab').classList.remove('low'); return; }
    const ms = Math.max(0, state.localDeadline - Date.now());
    const left = Math.min(30, Math.ceil(ms / 1000)); // 멈춤(시작 화면·원카드)으로 늘어난 시간은 30초로 보여 준다
    if (t.textContent !== String(left)) {
      t.textContent = left;
      // 10초부터는 숫자가 바뀔 때마다 톡 튄다
      if (left <= 10) { t.classList.remove('tick'); void t.offsetWidth; t.classList.add('tick'); }
    }
    $('trayTab').classList.toggle('low', left <= 10);
    bar.hidden = false; bar.classList.remove('off');
    bar.classList.toggle('low', left <= 10);
    bar.firstElementChild.style.transform = `scaleX(${Math.min(1, ms / 30000)})`;
  }
  setInterval(updateTimer, 200);

  // --- 테이블 색 (이 기기에 기억) ---
  const BGS = ['green', 'navy', 'burgundy', 'wood', 'charcoal'];
  function setBg(v) {
    if (!BGS.includes(v)) v = 'green';
    document.body.dataset.bg = v;
    store.set('onecard-bg', v);
    document.querySelectorAll('#bgModal [data-bg]').forEach((b) => b.classList.toggle('on', b.dataset.bg === v));
  }
  setBg(store.get('onecard-bg'));
  document.querySelectorAll('#bgModal [data-bg]').forEach((b) => { b.onclick = () => setBg(b.dataset.bg); });
  const openBg = () => { $('bgModal').hidden = false; };
  $('btnBg').onclick = () => { closeMenu(); openBg(); };
  $('btnBgHome').onclick = openBg;
  $('bgClose').onclick = () => { $('bgModal').hidden = true; };

  // --- 봇 실력 안내 ---
  const BOT_INFO = [
    { t: 'silver', who: '처음 배우는 사람', win: 11, play: ['낼 수 있는 카드 중 아무거나 내요', '같은 숫자를 자주 몰아서 내요', '가끔 받아칠 수 있는데 그냥 먹어요 (15%)', '가끔 낼 수 있는데 뽑아요 (5%)'], self: '85% · 0.6~1.4초', catchS: '70% · 0.8~1.6초' },
    { t: 'gold', who: '보통 실력', win: 27, play: ['공격 카드(2, A)부터 내요', '같은 숫자는 항상 몰아서 내요'], self: '92% · 0.5~1.1초', catchS: '82% · 0.6~1.3초' },
    { t: 'platinum', who: '잘하는 사람', win: 43, play: ['공격 카드와 조커를 아꼈다가 공격받을 때 받아쳐요', '받아칠 때 싼 카드부터, 3은 막기용으로 남겨요', '가끔 덜 좋은 수를 둬요 (5%)'], self: '96% · 0.4~0.85초', catchS: '90% · 0.45~1초' },
    { t: 'master', who: '고수', win: 58, play: ['플래티넘의 요령 + 나온 카드를 기억해요', '한 장 남은 사람을 아껴 둔 공격으로 끊어요', '7로 바꿀 무늬는 다음 사람에게 없을 무늬로 골라요', '아주 가끔 실수해요 (2%)'], self: '98% · 0.28~0.55초', catchS: '96% · 0.32~0.62초' },
    { t: 'grandmaster', who: '최고수', win: 63, play: ['마스터의 판단 + 실수가 없어요', '같은 숫자를 남겨 두었다가 한 번에 끝내요 (원카드 상황을 건너뜀)', '다음 사람에게 없는 무늬로 몰아가요', 'Q로 방향을 돌려 거의 끝난 사람을 늦춰요', '둘이서 할 때 J·Q를 연달아 내요'], self: '100% · 0.18~0.38초', catchS: '99% · 0.2~0.42초' },
  ];
  function renderBotInfo() {
    const list = $('biList');
    list.innerHTML = '';
    for (const b of BOT_INFO) {
      const card = document.createElement('section');
      card.className = `bi-card t-${b.t}`;
      card.innerHTML = `<header>${tierTag(b.t)}<span class="bi-who"></span><span class="bi-win"><b>${b.win}%</b> 승률</span></header>
        <div class="bi-meter" aria-hidden="true"><i style="width:${Math.min(100, b.win / 65 * 100)}%"></i></div>
        <ul class="bi-play"></ul>
        <dl class="bi-react"><div><dt>내 원카드 외치기</dt><dd></dd></div><div><dt>남의 원카드 잡기</dt><dd></dd></div></dl>`;
      card.querySelector('.bi-who').textContent = b.who;
      for (const line of b.play) { const li = document.createElement('li'); li.textContent = line; card.querySelector('.bi-play').appendChild(li); }
      const dd = card.querySelectorAll('dd');
      dd[0].textContent = b.self; dd[1].textContent = b.catchS;
      list.appendChild(card);
    }
  }
  $('btnBotInfo').onclick = () => { renderBotInfo(); $('botInfoModal').hidden = false; };
  $('biClose').onclick = () => { $('botInfoModal').hidden = true; };

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
  $('btnBot').onclick = () => { $('tierPick').hidden = !$('tierPick').hidden; };
  document.querySelectorAll('#tierPick [data-tier]').forEach((b) => {
    b.innerHTML = tierIcon(b.dataset.tier) + `<span>${TIER_NAME[b.dataset.tier]}</span>`;
    b.onclick = () => { socket.emit('addBot', b.dataset.tier); };
  });
  $('btnStart').onclick = () => socket.emit('start');
  $('btnLeave').onclick = () => {
    socket.emit('leave'); state = null; show('home');
    history.replaceState(null, '', location.pathname);
  };

  // 게임 중 나가기 (확인 후)
  $('btnQuit').onclick = () => {
    const g = state && state.game;
    $('quitMsg').textContent = g && !g.finished ? '지금 나가면 이번 판에서 빠지고, 내 카드는 바닥 아래로 들어가요.' : '방에서 나갈까요?';
    $('quitModal').hidden = false;
  };
  $('quitCancel').onclick = () => { $('quitModal').hidden = true; };
  $('quitOk').onclick = () => {
    $('quitModal').hidden = true;
    socket.emit('leave'); state = null; show('home');
    $('onePop').hidden = true; $('introPop').hidden = true; deal = null; introTimers.forEach(clearTimeout); $('resultModal').hidden = true; $('side').hidden = true; $('settingsModal').hidden = true; $('menuPanel').hidden = true;
    history.replaceState(null, '', location.pathname);
  };

  let actBusyUntil = 0; // 뽑기·내기를 보낸 뒤 답이 올 때까지 (최대 1.5초) 다시 보내지 않는다
  const emitDraw = () => { if (Date.now() < actBusyUntil) return; actBusyUntil = Date.now() + 1500; socket.emit('draw'); };
  const tableFree = () => Date.now() >= guardUntil && $('onePop').hidden && $('introPop').hidden && !deal;
  $('btnDraw').onclick = () => { if (tableFree()) emitDraw(); };
  $('btnMulti').onclick = () => { if (state && state.game && selected.length) submitPlay(selected.slice(), state.game); };
  $('btnMultiCancel').onclick = () => { selected = []; render(); };
  $('deck').onclick = () => { if (state && state.game && state.game.turn === state.me && tableFree()) emitDraw(); };
  $('btnOne').onclick = (e) => { e.stopPropagation(); if (!$('btnOne').disabled) socket.emit('oneCard'); };
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && !$('game').hidden) { e.preventDefault(); if (!$('onePop').hidden && !$('btnOne').disabled) socket.emit('oneCard'); }
  });

  document.querySelectorAll('#suitModal [data-suit]').forEach((b) => {
    b.onclick = () => {
      $('suitModal').hidden = true;
      if (pendingSeven !== null) emitPlay(pendingSeven, b.dataset.suit);
      selected = [];
      pendingSeven = null;
    };
  });
  $('suitCancel').onclick = () => { $('suitModal').hidden = true; pendingSeven = null; };

  $('btnAgain').onclick = () => { $('resultModal').hidden = true; socket.emit('start'); };
  $('btnToLobby').onclick = () => { $('resultModal').hidden = true; shownResult = 'closed'; chatLines.length = 0; $('log').innerHTML = ''; render(); };

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
    let anchor = state && id === state.me ? $('trayTab') : document.querySelector(`.opp[data-id="${id}"]`);
    if (!anchor || $('game').hidden) return;
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'emote-float ' + kind;
    el.textContent = text;
    const isOpp = id !== state.me;
    el.classList.add(isOpp ? 'from-opp' : 'from-me');
    el.style.left = Math.min(Math.max(r.left + r.width / 2, 70), window.innerWidth - 70) + 'px';
    el.style.top = (isOpp ? r.bottom + 8 : r.top - 8) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  $('btnLog').onclick = () => { closeMenu(); $('side').hidden = false; $('btnMenu').classList.remove('dot'); $('btnLog').classList.remove('dot'); };

  // --- 오른쪽 위 메뉴: 테마 변경 · 기록·채팅 · 설정 ---
  function closeMenu() { $('menuPanel').hidden = true; $('btnMenu').setAttribute('aria-expanded', 'false'); }
  $('btnMenu').onclick = (e) => {
    e.stopPropagation();
    const open = $('menuPanel').hidden;
    $('menuPanel').hidden = !open;
    $('btnMenu').setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('click', (e) => { if (!$('menuPanel').hidden && !$('menuPanel').contains(e.target)) closeMenu(); });
  // 설정
  // 아이폰(사파리)은 웹사이트 진동을 지원하지 않는다: 켤 수 없게 하고 이유를 보여 준다
  const canVibrate = typeof navigator.vibrate === 'function';
  if (!canVibrate) {
    vibrateOn = false;
    $('optVibrate').disabled = true;
    $('rowVibrate').classList.add('off');
    $('vibNote').textContent = '이 기기(아이폰 등)의 브라우저는 진동을 지원하지 않아요';
  }
  $('optVibrate').checked = vibrateOn;
  $('optCalm').checked = reduceMotion;
  $('optVibrate').onchange = () => {
    vibrateOn = $('optVibrate').checked; store.set('onecard-vibrate', vibrateOn ? '1' : '0');
    if (vibrateOn) try { navigator.vibrate(60); } catch {} // 켜면 바로 한 번 떨려서 되는지 알 수 있게
  };
  $('optCalm').onchange = () => { reduceMotion = sysCalm || $('optCalm').checked; store.set('onecard-calm', $('optCalm').checked ? '1' : '0'); document.body.classList.toggle('calm', reduceMotion); };
  document.body.classList.toggle('calm', reduceMotion);
  $('btnSettings').onclick = () => { closeMenu(); $('settingsModal').hidden = false; };
  $('setClose').onclick = () => { $('settingsModal').hidden = true; };
  $('setTutorial').onclick = () => { $('settingsModal').hidden = true; $('btnTutorial').click(); };
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
      shownResult = false; seenSeq = 0; $('resultModal').hidden = true; pileSeen.clear(); $('onePop').hidden = true; raceSeen = {}; myPress = {}; gameNo++;
      chatLines.length = 0; $('log').innerHTML = ''; // 경기 기록은 판마다 새로
    }
    // 애니메이션용: 바뀌기 전 상태와 내 카드 위치
    const handRects = {};
    document.querySelectorAll('#hand .card').forEach((el) => { handRects[el.dataset.id] = el.getBoundingClientRect(); });
    const sameGame = prevGame && s.game && !(s.game && !s.game.finished && prevGame.finished);
    anim = { prev: sameGame ? prevGame : null, handRects };
    state = s;
    actBusyUntil = 0;
    maybeStartIntro(s);
    state.localDeadline = s.turnLeft != null ? Date.now() + s.turnLeft : null;
    history.replaceState(null, '', `${location.pathname}?room=${s.lobby.code}`);
    render();
  });
  socket.on('toast', (m) => { toast(m); localFlown.clear(); actBusyUntil = 0; render(); });
  socket.on('pressed', ({ raceId, ms, place }) => { myPress[raceId] = { ms, place }; renderOnePop(); });
  // 같은 ID가 이미 다른 탭에서 접속 중이면 새 ID로 다시 참가
  socket.on('uidTaken', ({ code }) => {
    uid = newUid(); tabStore.set('onecard-uid', uid);
    const name = store.get('onecard-name') || $('name').value.trim();
    socket.emit('join', { name, uid, code });
  });
  socket.on('chat', (c) => {
    chatLines.push(c);
    if ($('side').hidden) { $('btnMenu').classList.add('dot'); $('btnLog').classList.add('dot'); toast(`${c.name}: ${c.text}`); }
    if (state && state.game) renderLog(state.game.log);
  });
  socket.on('emote', (m) => {
    floatEmote(m);
    if (m.kind === 'phrase') {
      chatLines.push({ name: m.name, text: m.text });
      if (state && state.game) renderLog(state.game.log);
    }
  });
  // 다시 연결했는데 방이 없으면 (서버가 다시 시작된 경우 등) 처음 화면으로
  socket.on('noRoom', () => {
    if (!state) return;
    state = null; deal = null; introTimers.forEach(clearTimeout);
    for (const id of ['onePop', 'introPop', 'racePanel', 'resultModal', 'suitModal', 'quitModal', 'side']) $(id).hidden = true;
    show('home');
    history.replaceState(null, '', location.pathname);
    setTimeout(() => toast('서버가 다시 시작돼서 방이 없어졌어요. 방을 새로 만들어 주세요.'), 50);
  });
  socket.on('kicked', () => { state = null; show('home'); toast('방에서 내보내졌어요.'); history.replaceState(null, '', location.pathname); });

  // 재접속: 방 코드가 주소에 있고 이전에 닉네임이 있었다면 자동 참가 시도
  // 연결이 끊기면 위에 알림 (다시 연결되면 자동으로 방에 돌아간다)
  socket.on('disconnect', () => { $('netBanner').hidden = false; });
  socket.io.on('reconnect_attempt', () => { $('netBanner').hidden = false; });
  socket.on('connect', () => { $('netBanner').hidden = true; localFlown.clear(); actBusyUntil = 0; });
  socket.on('connect', () => {
    const code = (state && state.lobby && state.lobby.code) || params.get('room');
    const name = store.get('onecard-name');
    if (code && name && (state || tabStore.get('onecard-last-room') === code.toUpperCase())) {
      socket.emit('join', { name, uid, code });
    }
  });
  socket.on('state', (s) => tabStore.set('onecard-last-room', s.lobby.code));
})();
