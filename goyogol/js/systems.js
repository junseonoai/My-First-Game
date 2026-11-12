/* systems.js — 게임 규칙: 가방, 돈, 숙련도, 퀘스트, 의뢰 게시판, 저장.
 * 화면과 월드를 직접 만지지 않고, 바뀐 것은 G.bus 로 알린다('toast', 'hud', 'quest' 등). */
'use strict';
(() => {
  const D = G.DATA;
  const S = G.sys = {
    hp: 20, coins: 0, inv: {}, skills: {}, quests: {}, flags: {}, board: null, calmTotal: 0, pos: null,
  };
  const toast = msg => G.bus.emit('toast', msg);

  /* ---------- 숙련도 ---------- */
  S.level = id => S.skills[id].lv;
  S.xpNeed = lv => Math.round(18 * Math.pow(lv, 1.5));
  S.addXp = (id, amt) => {
    const sk = S.skills[id]; sk.xp += amt;
    while (sk.xp >= S.xpNeed(sk.lv)) { sk.xp -= S.xpNeed(sk.lv); sk.lv++; toast(`${D.skills[id].name} 숙련도 ${sk.lv} — 몸이 기억해 낸다`); if (id === 'tough') S.hp = Math.min(S.maxHp(), S.hp + 3); }
    G.bus.emit('hud');
  };
  /** 숙련도와 도구가 주는 효과를 한곳에서 계산한다. 수치 조정은 여기서. */
  S.maxHp = () => 20 + (S.level('tough') - 1) * 3;
  S.damage = () => 3 + (S.level('combat') - 1);
  S.chopsNeeded = () => Math.max(2, 5 - Math.floor((S.level('logging') - 1) / 2) - (S.has('axe2') ? 1 : 0));
  S.bonusChance = id => Math.min(.75, (S.level(id) - 1) * .12);

  /* ---------- 가방 ---------- */
  S.count = id => S.inv[id] || 0;
  S.has = (id, n = 1) => S.count(id) >= n;
  S.add = (id, n = 1, quiet) => { S.inv[id] = S.count(id) + n; if (!quiet) toast(`${D.items[id].name} +${n}`); G.bus.emit('hud'); };
  S.take = (id, n = 1) => { if (!S.has(id, n)) return false; S.inv[id] -= n; if (!S.inv[id]) delete S.inv[id]; G.bus.emit('hud'); return true; };
  S.addCoins = n => { S.coins += n; G.bus.emit('hud'); };
  S.useItem = id => {
    const u = D.items[id].use; if (!u || !S.has(id)) return false;
    if (u.heal) { if (S.hp >= S.maxHp()) { toast('체력이 이미 가득하다'); return false; } S.take(id); S.heal(u.heal); toast(`${D.items[id].name}을 마셨다`); }
    return true;
  };
  S.heal = n => { S.hp = Math.min(S.maxHp(), S.hp + n); G.bus.emit('hud'); };

  /* ---------- 퀘스트 ----------
   * 상태: undefined(잠김) → 'active' → 'done'. q.step = 현재 단계 번호, q.n = calm 진행 수 */
  const qdef = id => D.quests.find(q => q.id === id);
  const ready = q => !S.quests[q.id] && q.requires.every(r => S.quests[r] && S.quests[r].state === 'done');
  S.activeQuests = () => D.quests.filter(q => S.quests[q.id] && S.quests[q.id].state === 'active');
  S.currentStep = q => q.steps[S.quests[q.id].step];
  S.startQuest = q => { S.quests[q.id] = { state: 'active', step: 0, n: 0 }; if (q.give) for (const k in q.give) S.add(k, q.give[k]); toast(`새 할 일: ${q.title}`); G.bus.emit('quest'); };
  const advance = q => {
    const st = S.quests[q.id]; st.step++; st.n = 0;
    if (st.step >= q.steps.length) {
      st.state = 'done';
      const r = q.reward || {};
      if (r.coins) { S.addCoins(r.coins); toast(`${q.title} 완료 — ◈ ${r.coins}`); } else toast(`${q.title} 완료`);
      if (r.items) for (const k in r.items) S.add(k, r.items[k]);
      S.checkAuto();
    }
    G.bus.emit('quest'); S.save();
  };
  /** 조건이 된 자동 시작 퀘스트를 연다 */
  S.checkAuto = () => { for (const q of D.quests) if (q.auto && ready(q)) S.startQuest(q); };
  /** 주민 머리 위 표시용: '!' = 줄 일이 있음, '?' = 진행 중인 일의 상대 */
  S.npcMark = npc => {
    for (const q of S.activeQuests()) { const s = S.currentStep(q); if (s.npc === npc && (s.type === 'talk' || s.type === 'collect')) return s.type === 'collect' && !S.has(s.item, s.n) ? '' : '?'; }
    for (const q of D.quests) if (q.giver === npc && ready(q)) return '!';
    return '';
  };
  /** 주민에게 말을 걸었을 때. 보여 줄 대사 묶음과, 대사가 끝난 뒤 할 일을 돌려준다. */
  S.talk = npc => {
    for (const q of S.activeQuests()) {
      const s = S.currentStep(q);
      if (s.npc !== npc) continue;
      if (s.type === 'talk') return { lines: s.lines, after: () => advance(q) };
      if (s.type === 'collect') {
        if (S.has(s.item, s.n)) return { lines: s.lines, after: () => { S.take(s.item, s.n); advance(q); } };
        return { lines: s.wait };
      }
    }
    for (const q of D.quests) if (q.giver === npc && ready(q)) return { lines: q.intro, after: () => { S.startQuest(q); S.save(); } };
    const n = D.npcs[npc];
    return { lines: [[n.name, n.idle[Math.floor(Math.random() * n.idle.length)]]], shop: !!n.shop };
  };
  /** 흐려진 생물 하나를 달랬을 때 */
  S.onCalm = () => {
    S.calmTotal++;
    for (const q of S.activeQuests()) { const s = S.currentStep(q); if (s.type === 'calm') { const st = S.quests[q.id]; st.n++; if (st.n >= s.n) advance(q); else G.bus.emit('quest'); } }
  };
  /** 기억의 돌 앞에서: 지금 바칠 수 있는 단계가 있으면 돌려준다 */
  S.offerStep = stone => { for (const q of S.activeQuests()) { const s = S.currentStep(q); if (s.type === 'offer' && s.stone === stone) return { q, s }; } return null; };
  S.canOffer = s => Object.keys(s.items).every(k => S.has(k, s.items[k]));
  S.doOffer = (q, s) => { for (const k in s.items) S.take(k, s.items[k]); S.flags['stone' + s.stone[0].toUpperCase() + s.stone.slice(1)] = true; advance(q); };
  /** 화면 오른쪽 위 할 일 목록에 쓸 글 */
  S.tracker = () => S.activeQuests().map(q => {
    const s = S.currentStep(q), st = S.quests[q.id]; let t = s.text;
    if (s.type === 'collect') t += ` (${Math.min(S.count(s.item), s.n)}/${s.n})`;
    if (s.type === 'calm') t += ` (${st.n}/${s.n})`;
    if (s.type === 'offer') t += ' — ' + Object.keys(s.items).map(k => `${D.items[k].name} ${Math.min(S.count(k), s.items[k])}/${s.items[k]}`).join(', ');
    return { title: q.title, text: t };
  });

  /* ---------- 의뢰 게시판 ---------- */
  S.rollBoard = () => { let i; do { i = Math.floor(Math.random() * D.board.length); } while (S.board === i && D.board.length > 1); S.board = i; };
  S.boardJob = () => D.board[S.board];
  S.turnInBoard = () => { const j = S.boardJob(); if (!S.take(j.item, j.n)) return false; S.addCoins(j.coins); toast(`의뢰 완료 — ◈ ${j.coins}`); S.rollBoard(); S.save(); return true; };

  /* ---------- 저장 ---------- */
  S.reset = () => {
    S.coins = 0; S.inv = {}; S.quests = {}; S.flags = {}; S.calmTotal = 0; S.pos = null;
    S.skills = {}; for (const k in D.skills) S.skills[k] = { lv: 1, xp: 0 };
    S.hp = S.maxHp(); S.rollBoard();
  };
  S.save = () => {
    if (!S.started) return;
    const p = G.player; if (p) S.pos = [p.x, p.z, p.rot];
    try { localStorage.setItem(G.SAVE_KEY, JSON.stringify({ v: 1, hp: S.hp, coins: S.coins, inv: S.inv, skills: S.skills, quests: S.quests, flags: S.flags, board: S.board, calmTotal: S.calmTotal, pos: S.pos })); } catch (e) { /* 저장 불가 환경은 조용히 넘어간다 */ }
  };
  S.hasSave = () => { try { return !!localStorage.getItem(G.SAVE_KEY); } catch (e) { return false; } };
  S.load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(G.SAVE_KEY)); if (!d || d.v !== 1) return false;
      S.reset(); Object.assign(S, { hp: d.hp, coins: d.coins, inv: d.inv || {}, quests: d.quests || {}, flags: d.flags || {}, calmTotal: d.calmTotal || 0, pos: d.pos || null });
      for (const k in D.skills) if (d.skills && d.skills[k]) S.skills[k] = d.skills[k];
      if (d.board != null && D.board[d.board]) S.board = d.board;
      return true;
    } catch (e) { return false; }
  };
  S.wipe = () => { try { localStorage.removeItem(G.SAVE_KEY); } catch (e) { /* 무시 */ } };

  S.reset();
})();
