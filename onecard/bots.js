// 원카드 봇 6단계: 실버 · 골드 · 플래티넘 · 마스터 · 그랜드마스터 · 챌린저
//
// 모든 봇은 사람이 볼 수 있는 정보만 쓴다: 내 손패, 바닥에 나온 카드, 각자 손패 장수,
// 누가 카드를 못 내고 뽑았는지·공격을 먹었는지(그때 없던 카드). 다른 사람 손패를 훔쳐보지 않는다.
//
// 실버        낼 수 있는 카드 중 아무거나. 가끔 기회를 놓친다.
// 골드        공격 카드 먼저, 같은 숫자는 몰아서 (예전 기본 봇).
// 플래티넘    공격·조커 아꼈다가 받아치기 + 주도권 무늬, 비상구 카드, 공격 떠넘기기, 남은 공격 세기 (proMove).
// 마스터      플래티넘 + 추리로 무늬 고르기, 1장 남은 사람 끊기, 선두 견제, 파산 피하기. 둘만 남으면 모의 게임 40판.
// 그랜드마스터 마스터 + 한 번에 끝내기, 짝 남기기, K 이어 내기, 덱 섞일 때 계산, 원카드 피해 가기. 모의 게임 100판.
// 챌린저      그랜드마스터 + 사람 버릇 읽기. 모의 게임 300판. 원카드 반응이 가장 빠르다.
//
// 모의 게임(search.js)은 넷이서는 효과가 없어서(남의 패를 좁히기 어려움) 둘만 남았을 때만 쓴다.
// 단계별 실험 결과는 test/TIERS.md 참고.

const { attackValue, isJoker, SUITS, makeDeck } = require('./game');

const TIERS = ['silver', 'gold', 'platinum', 'master', 'grandmaster', 'challenger'];
const TIER_NAMES = { silver: '실버', gold: '골드', platinum: '플래티넘', master: '마스터', grandmaster: '그랜드마스터', challenger: '챌린저' };

// 원카드 버튼 반응 (버튼이 열린 뒤 ms). 2초 안에 못 누르면 실패.
// self: 내 원카드를 외칠 확률과 시간, catch: 남의 원카드를 잡을 확률과 시간
const REACTION = {
  silver: { self: 0.85, selfMs: [600, 1400], catch: 0.7, catchMs: [800, 1600] },
  gold: { self: 0.92, selfMs: [500, 1100], catch: 0.82, catchMs: [600, 1300] },
  platinum: { self: 0.96, selfMs: [400, 850], catch: 0.9, catchMs: [450, 1000] },
  master: { self: 0.98, selfMs: [280, 550], catch: 0.96, catchMs: [320, 620] },
  grandmaster: { self: 1, selfMs: [180, 380], catch: 0.99, catchMs: [200, 420] },
  challenger: { self: 1, selfMs: [150, 200], catch: 0.99, catchMs: [150, 300] },
};

// 일부러 넣는 작은 실수 (사람 같은 느낌): 이 확률로 최선 대신 아무 낼 수 있는 카드
const MISTAKE = { platinum: 0.05, master: 0.02, grandmaster: 0, challenger: 0 };

const FULL_DECK = makeDeck();

// 아직 보지 못한 카드 = 전체 − 내 손패 − 바닥 (덱과 남들 손패 어딘가에 있음)
function unseenCards(g, me) {
  const known = new Set([...me.hand, ...g.discard].map((c) => c.id));
  return FULL_DECK.filter((c) => !known.has(c.id));
}

function nextPlayer(g, botId) {
  const n = g.players.length;
  let t = g.players.findIndex((x) => x.id === botId);
  for (let k = 0; k < n; k++) {
    t = (t + g.dir + n) % n;
    if (!g.players[t].out) return g.players[t];
  }
  return null;
}

// 실버: 아무 카드나. 가끔 받아칠 수 있어도 그냥 먹거나, 낼 수 있는데 뽑는다. 같은 숫자는 가끔만 몰아서
const SILVER = { eatAttack: 0.15, drawAnyway: 0.05, multi: 0.85 };
function silverMove(g, me) {
  const playable = me.hand.filter((c) => g.canPlay(c));
  if (!playable.length) return { draw: true };
  if (g.penalty > 0 && Math.random() < SILVER.eatAttack) return { draw: true };
  if (g.penalty === 0 && Math.random() < SILVER.drawAnyway) return { draw: true };
  const c = playable[Math.floor(Math.random() * playable.length)];
  const ids = [c.id];
  if (!isJoker(c) && Math.random() < SILVER.multi) for (const x of me.hand) if (x.id !== c.id && x.rank === c.rank) ids.push(x.id);
  return { ids, suit: c.rank === '7' && g.penalty === 0 ? SUITS[Math.floor(Math.random() * 4)] : undefined };
}

// 실수: 낼 수 있는 카드 중 아무거나 한 장 (같은 숫자는 몰아서)
function sloppyMove(g, me) {
  const playable = me.hand.filter((c) => g.canPlay(c));
  const c = playable[Math.floor(Math.random() * playable.length)];
  const ids = [c.id];
  if (!isJoker(c)) for (const x of me.hand) if (x.id !== c.id && x.rank === c.rank) ids.push(x.id);
  return { ids, suit: c.rank === '7' && g.penalty === 0 ? bestSuit(g, me, new Set(ids), false, null) : undefined };
}

// 7로 바꿀 무늬: 내가 많이 가진 무늬. smart면 아직 안 나온 카드가 많은 무늬(남들이 가졌을 법한)는 피하고,
// 다음 사람이 없다고 드러난 무늬를 고른다
function bestSuit(g, p, used, smart, next) {
  const val = {};
  for (const s of SUITS) val[s] = 0;
  for (const c of p.hand) if (!used.has(c.id) && SUITS.includes(c.suit)) val[c.suit] += attackValue(c) > 0 ? 0.5 : 1;
  if (smart) {
    const unseen = unseenCards(g, p);
    for (const s of SUITS) val[s] -= 0.12 * unseen.filter((c) => c.suit === s).length;
    if (next && g.voids[next.id]) val[g.voids[next.id]] += next.hand.length <= 3 ? 2 : 0.8;
  }
  return SUITS.slice().sort((a, b) => val[b] - val[a])[0];
}

// 플래티넘·마스터
//  - 공격 카드(2, A)와 조커는 아꼈다가 공격받을 때 받아치는 데 쓴다
//  - 받아칠 때는 싼 카드부터 (2 → A → A♠), 3은 막기용으로 남긴다
//  - 같은 숫자는 몰아서 낸다
// 마스터(smart)는 여기에 카드 기억과 상대 추리를 더한다
//  - 다음 사람이 한 장 남았으면 아껴 둔 공격으로 끊는다
//  - 7로 무늬를 바꿀 때 아직 많이 남은 무늬는 피하고, 다음 사람에게 없는 무늬를 고른다
//  - 여러 장을 낼 때 마지막 카드(바닥 무늬)를 내가 많이 가진 무늬로
function planMove(g, botId, smart) {
  const p = g.find(botId);
  const playable = p.hand.filter((c) => g.canPlay(c));
  if (!playable.length) return { draw: true };
  const next = smart ? nextPlayer(g, botId) : null;
  const score = (c) => {
    if (g.penalty > 0) {
      if (isJoker(c)) return 10;
      if (g.isBlock(c)) return 30;
      return 50 - attackValue(c); // 싼 공격 카드부터 받아치기
    }
    if (smart && next && next.hand.length <= 1) {
      if (attackValue(c) > 0) return 45 + attackValue(c);
      if (isJoker(c)) return 44;
    }
    if (isJoker(c)) return 5;
    if (attackValue(c) > 0) return 8;
    if (c.rank === '3') return 12;
    if (['J', 'Q', 'K'].includes(c.rank)) return 30;
    if (c.rank === '7') return 10;
    return 20;
  };
  playable.sort((a, b) => score(b) - score(a));
  return withPartners(g, p, playable[0], smart, next);
}

// 고른 카드 + 같은 숫자 카드 몰아서. smart면 마지막(바닥에 남을) 카드를 내가 많이 가진 무늬로
function withPartners(g, p, card, smart, next) {
  const ids = [card.id];
  if (!isJoker(card)) {
    const rest = p.hand.filter((c) => c.id !== card.id && c.rank === card.rank);
    if (smart && rest.length) {
      const left = p.hand.filter((c) => c.rank !== card.rank);
      const cnt = (s) => left.filter((c) => c.suit === s).length;
      rest.sort((a, b) => cnt(a.suit) - cnt(b.suit));
    }
    for (const c of rest) ids.push(c.id);
  }
  const suit = card.rank === '7' && g.penalty === 0 ? bestSuit(g, p, new Set(ids), smart, next) : undefined;
  return { ids, suit };
}

// 그랜드마스터: 마스터의 판단 + 실수 없음 + 아래 기술
//  - 마무리 계획: 남은 손패가 모두 같은 숫자면 한꺼번에 내서 끝낸다 (원카드 상황을 건너뜀).
//    손패가 적을 때는 같은 숫자 짝을 깨지 않고 남겨 둔다
//  - 공격 몰기: 다음 사람이 두 장 이하면 아껴 둔 공격을 쓴다
//  - 무늬 추적: 다음 사람이 없다고 드러난 무늬를 바닥에 남기는 카드를 고른다
//  - 방향 활용: 다음 사람이 거의 끝났고 반대쪽 사람은 여유가 있으면 Q로 방향을 바꾼다
//  - 둘이서 할 때: J·Q·K는 다시 내 차례이므로 먼저 털어 낸다
// 그랜드마스터 기술 켜고 끄기 (시뮬레이션으로 조정할 때 씀)
const GM = { finish: true, attack2: false, voidBonus: true, qTurn: true, duelJQ: true, keepPairs: true };
function gmMove(g, botId) {
  const p = g.find(botId);
  const playable = p.hand.filter((c) => g.canPlay(c));
  if (!playable.length) return { draw: true };
  const next = nextPlayer(g, botId);
  const alive = g.alive();
  const duel = alive.length === 2;
  const hand = p.hand;
  const rankCount = (r) => hand.filter((c) => c.rank === r).length;

  // 마무리: 남은 카드가 모두 같은 숫자이고 낼 수 있으면 전부
  const first = playable.find((c) => !isJoker(c) && hand.every((x) => x.rank === c.rank));
  if (GM.finish && first && g.penalty === 0) return withPartners(g, p, first, true, next);

  // 방향을 바꾸면 다음이 될 사람 (셋 이상)
  let prevP = null;
  if (!duel) {
    const n = g.players.length;
    let t = g.players.findIndex((x) => x.id === botId);
    for (let k = 0; k < n; k++) { t = (t - g.dir + n) % n; if (!g.players[t].out) { prevP = g.players[t]; break; } }
  }
  const nextVoid = next && g.voids[next.id];
  const small = hand.length <= 4;
  // 공격 카드를 두 장 이상 들고 있을 때만 두 장 남은 사람에게도 쓴다 (한 장은 막을 때를 위해 남김)
  const spareAttacks = hand.filter((c) => attackValue(c) > 0 || isJoker(c)).length >= 2;

  const score = (c) => {
    if (g.penalty > 0) {
      if (isJoker(c)) return 10;
      if (g.isBlock(c)) return 30;
      return 50 - attackValue(c);
    }
    let v;
    if (next && next.hand.length <= (GM.attack2 && spareAttacks ? 2 : 1) && (attackValue(c) > 0 || isJoker(c))) v = 45 + attackValue(c); // 공격 몰기
    else if (isJoker(c)) v = 5;
    else if (attackValue(c) > 0) v = 8;
    else if (c.rank === '3') v = 12;
    else if (c.rank === '7') v = 10;
    else if (['J', 'Q', 'K'].includes(c.rank)) v = duel && GM.duelJQ ? 60 : 30; // 둘이면 다시 내 차례
    else v = 20;
    if (GM.qTurn && !duel && c.rank === 'Q' && next && prevP && next.hand.length <= 1 && prevP.hand.length >= 3) v = 55; // 방향 돌리기
    // 바닥에 남을 무늬가 다음 사람에게 없는 무늬면 좋다
    if (GM.voidBonus && nextVoid && c.suit === nextVoid && attackValue(c) === 0 && !isJoker(c)) v += next.hand.length <= 3 ? 6 : 3;
    // 손패가 적으면 같은 숫자 짝은 깨지 않는다 (나중에 한 번에 끝내려고)
    if (GM.keepPairs && small && !isJoker(c) && rankCount(c.rank) >= 2 && rankCount(c.rank) < hand.length) v -= 9;
    return v;
  };
  playable.sort((a, b) => score(b) - score(a));
  return withPartners(g, p, playable[0], true, next);
}

// =====================================================================
// 플래티넘 이상 공통 판단 (기술마다 켜고 끌 수 있다)
//  save  공격·조커 아꼈다가 받아치기, 싼 카드부터 받아치기, 3은 막기용 (플래티넘의 핵심)
//  smart 7로 바꿀 무늬·여러 장 낼 때 바닥에 남길 무늬를 추리로 고르기, 다음 사람 1장이면 끊기
//  gm    같은 숫자로 한 번에 끝내기, 짝 남기기, 다음 사람에게 없는 무늬 남기기, Q로 방향 돌리기, 둘이서 J·Q·K 먼저
//  A1 주도권 무늬      바닥에 남길 무늬를 내가 많이 가진 무늬로 (다음 차례에도 낼 카드가 있게)
//  A2 탈출 카드 아끼기  7·조커는 낼 게 없을 때를 위해 마지막 한 장은 남긴다
//  A3 K 이어 내기      손패가 적을 때 K 다음 카드로 바로 끝낼 수 있으면 K부터
//  A4 파산 피하기      손패가 많으면 받아치기·막기 카드를 아낀다
//  B1 선두 견제        판에서 손패가 가장 적은 사람을 노린다 (J로 건너뛰기, Q로 그 사람에게 넘기지 않기)
//  B2 공격 떠넘기기    공격을 받아칠 때 다음 사람이 위험하면 더 센 카드로 더 크게 넘긴다
//  B3 사람 버릇 읽기   사람이 이번 판에 자주 못 낸 무늬를 기억해 그 무늬로 바꾼다
//  C1 남은 공격 세기   아직 안 나온 공격 카드가 적으면 받아치기 카드를 덜 아끼고 일찍 턴다
//  C2 덱 섞일 때 계산  덱이 거의 떨어지면 버린 카드가 다시 덱이 되므로 그것까지 센다
//  D1 원카드 피해 가기 상대가 원카드를 빨리 잡는 등급이면 한 장만 남는 수를 피한다
// =====================================================================
const FEATURES = {
  platinum: { save: 1, A1: 1, A2: 1, B2: 1, C1: 1 },
  master: { save: 1, smart: 1, A1: 1, A2: 1, B2: 1, C1: 1, A4: 1, B1: 1 },
  grandmaster: { save: 1, smart: 1, gm: 1, A1: 1, A2: 1, B2: 1, C1: 1, A4: 1, B1: 1, A3: 1, C2: 1, D1: 1 },
  challenger: { save: 1, smart: 1, gm: 1, A1: 1, A2: 1, B2: 1, C1: 1, A4: 1, B1: 1, A3: 1, C2: 1, D1: 1, B3: 1 },
};
const W = { A1: 1.2, A2: 3, B2: 1, C1: 2, A4: 20, B1J: 50, B1Q: 18, B1J2: 14, A3: 58, D1: 6 };

function prevPlayer(g, botId) {
  const n = g.players.length;
  let t = g.players.findIndex((x) => x.id === botId);
  for (let k = 0; k < n; k++) { t = (t - g.dir + n) % n; if (!g.players[t].out) return g.players[t]; }
  return null;
}
function afterNext(g, botId) {
  const nx = nextPlayer(g, botId);
  return nx ? nextPlayer(g, nx.id) : null;
}

function proMove(g, botId, F, tierOf) {
  const p = g.find(botId);
  const hand = p.hand;
  const playable = hand.filter((c) => g.canPlay(c));
  if (!playable.length) return { draw: true };
  const next = nextPlayer(g, botId);
  const alive = g.alive();
  const duel = alive.length === 2;
  const rankCount = (r) => hand.filter((c) => c.rank === r).length;
  const top = g.top();

  // 마무리: 남은 카드가 모두 같은 숫자이고 낼 수 있으면 전부
  if (F.gm && g.penalty === 0) {
    const first = playable.find((c) => !isJoker(c) && hand.every((x) => x.rank === c.rank));
    if (first) return withPartners(g, p, first, true, next);
  }

  // 남은 공격 카드 세기 (C1·C2): 내 손패와 바닥 말고 어딘가에 있는 공격 카드
  let attacksLeft = 99;
  if (F.C1) {
    const known = new Set([...hand, ...g.discard].map((c) => c.id));
    attacksLeft = FULL_DECK.filter((c) => !known.has(c.id) && (attackValue(c) > 0 || isJoker(c))).length;
    if (F.C2 && g.deck.length <= 6) attacksLeft += g.discard.slice(0, -1).filter((c) => attackValue(c) > 0 || isJoker(c)).length; // 곧 다시 섞여 나온다
  }
  // 판의 선두 (B1): 나 말고 손패가 가장 적은 사람
  let leader = null;
  if (F.B1) for (const q of alive) if (q.id !== botId && (!leader || q.hand.length < leader.hand.length)) leader = q;
  const prevP = !duel ? prevPlayer(g, botId) : null;
  const after2 = F.B1 && !duel ? afterNext(g, botId) : null;
  const nextVoid = next && g.voids[next.id];
  const small = hand.length <= 4;
  const escapes = hand.filter((c) => c.rank === '7' || isJoker(c)).length;
  // 상대 중 가장 빨리 원카드를 잡는 속도 (D1)
  let fastestCatch = 9e9;
  if (F.D1 && tierOf) for (const q of alive) if (q.id !== botId) fastestCatch = Math.min(fastestCatch, (REACTION[tierOf(q.id)] || REACTION.gold).catchMs[0]);
  const mySelfMax = tierOf ? (REACTION[tierOf(botId)] || REACTION.gold).selfMs[1] : 0;

  const score = (c) => {
    if (g.penalty > 0) {
      if (isJoker(c)) return 10;
      if (g.isBlock(c)) return 30;
      // B2: 다음 사람이 위험하면 센 카드로 크게 넘기기, 아니면 싼 카드부터
      if (F.B2 && next && next.hand.length <= 2) return 40 + attackValue(c) * W.B2;
      return 50 - attackValue(c);
    }
    let v;
    const atk = attackValue(c) > 0;
    if ((F.smart || F.gm) && next && next.hand.length <= 1 && (atk || isJoker(c))) v = 45 + attackValue(c); // 다음 사람 끊기
    else if (isJoker(c)) v = 5;
    else if (atk) v = F.save ? (F.C1 && attacksLeft <= 2 ? 20 - W.C1 : 8) : 40; // 남은 공격이 적으면 일찍 턴다
    else if (c.rank === '3') v = F.save ? 12 : 20;
    else if (c.rank === '7') v = 10;
    else if (['J', 'Q', 'K'].includes(c.rank)) v = F.gm && duel ? 60 : 30;
    else v = 20;
    // A1: 바닥에 남을 무늬를 내가 많이 가진 무늬로
    if (F.A1 && !isJoker(c) && c.rank !== '7') {
      const same = hand.filter((x) => x.suit === c.suit && x.rank !== c.rank).length;
      v += W.A1 * same;
    }
    // A2: 7·조커는 마지막 한 장을 비상구로 남긴다
    if (F.A2 && (c.rank === '7' || isJoker(c)) && escapes <= 1 && hand.length > 2 && !(next && next.hand.length <= 1)) v -= W.A2;
    // A4: 손패가 많으면 받아치기 카드를 아낀다
    if (F.A4 && hand.length >= 18 && (atk || isJoker(c) || c.rank === '3') && !(next && next.hand.length <= 1)) v -= W.A4;
    // B1: 선두 견제
    if (F.B1 && leader && leader.hand.length <= 2) {
      if (c.rank === 'J' && next && next.id === leader.id && !duel) v = Math.max(v, W.B1J); // 선두를 건너뛴다
      if (c.rank === 'Q' && prevP && prevP.id === leader.id && !duel) v -= W.B1Q; // 방향을 돌리면 선두에게 넘어간다
      if (c.rank === 'J' && after2 && after2.id === leader.id) v -= W.B1J2; // 건너뛰면 선두 차례가 된다
    }
    // gm: Q로 방향 돌려 끊기, 다음 사람에게 없는 무늬 남기기, 짝 남기기
    if (F.gm) {
      if (!duel && c.rank === 'Q' && next && prevP && next.hand.length <= 1 && prevP.hand.length >= 3) v = Math.max(v, 55);
      if (nextVoid && c.suit === nextVoid && !atk && !isJoker(c)) v += next.hand.length <= 3 ? 6 : 3;
      if (small && !isJoker(c) && rankCount(c.rank) >= 2 && rankCount(c.rank) < hand.length) v -= 9;
    }
    // A3: K 다음 카드로 바로 끝낼 수 있으면 K부터
    if (F.A3 && c.rank === 'K' && hand.length <= 3) {
      const rest = hand.filter((x) => x.rank !== 'K');
      if (rest.length === 1 && (isJoker(rest[0]) || rest[0].suit === c.suit)) v = Math.max(v, W.A3);
    }
    // D1: 상대가 나보다 빨리 원카드를 잡을 수 있으면 한 장만 남는 수를 피한다
    if (F.D1 && fastestCatch < mySelfMax) {
      const left = hand.length - (isJoker(c) ? 1 : rankCount(c.rank));
      if (left === 1) v -= W.D1;
    }
    return v;
  };
  playable.sort((a, b) => score(b) - score(a));
  const pick = playable[0];
  const mv = withPartners(g, p, pick, !!(F.smart || F.gm), next);
  // B3: 7로 바꿀 무늬는 다음 사람(사람 플레이어)이 이번 판에 자주 못 낸 무늬로
  if (F.B3 && mv.suit && next && !next.bot && g.missCount && g.missCount[next.id]) {
    const mc = g.missCount[next.id];
    const mine = (s) => hand.filter((x) => x.suit === s && !mv.ids.includes(x.id)).length;
    const best = SUITS.slice().sort((a, b) => (mc[b] || 0) * 1.5 + mine(b) - ((mc[a] || 0) * 1.5 + mine(a)))[0];
    if ((mc[best] || 0) >= 2) mv.suit = best;
  }
  return mv;
}

// 모의 게임: 둘만 남았을 때(1대1·막판)만 쓴다 (넷이서는 남의 패를 좁히기 어려워 효과가 없었다). 판 수 = 등급별
const SEARCH = { master: 40, grandmaster: 100, challenger: 300 };
function wantSearch(g, tier) { return !!SEARCH[tier] && g.alive().length === 2 && !g.finished; }
// 모의 게임 계산기 (제너레이터). 판을 복사해서 계산하므로, 계산하는 동안 진짜 판이 바뀌어도 섞이지 않는다
function searchIter(g, botId, tier, tierOf) {
  const { searchGen, cloneGame } = require('./search');
  const snap = cloneGame(g);
  const prior = proMove(snap, botId, FEATURES[tier], tierOf);
  return searchGen(snap, botId, {
    samples: SEARCH[tier], prior, margin: 0.03,
    reactionOf: (id) => REACTION[tierOf(id)] || REACTION.gold,
    tierOf: (id) => (id === botId ? 'self' : tierOf(id)),
  });
}

// tierOf: 다른 사람들의 등급 (공개 정보, 원카드 반응 추정에 씀). 없으면 모두 골드로 본다
function chooseMove(g, botId, tier, tierOf, opts) {
  const me = g.find(botId);
  if (!me || me.out) return { draw: true };
  if (!(opts && opts.noSearch) && wantSearch(g, tier)) {
    const tf0 = tierOf || ((id) => { const q = g.find(id); return (q && q.tier) || 'gold'; });
    const it = searchIter(g, botId, tier, tf0);
    let r = it.next(); while (!r.done) r = it.next();
    return r.value;
  }
  if (MISTAKE[tier] && Math.random() < MISTAKE[tier] && me.hand.some((c) => g.canPlay(c))) return sloppyMove(g, me);
  const tf = tierOf || ((id) => { const q = g.find(id); return (q && q.tier) || 'gold'; });
  switch (tier) {
    case 'silver': return silverMove(g, me);
    case 'gold': return g.goldMove(botId);
    default: return proMove(g, botId, FEATURES[tier] || FEATURES.platinum, tf);
  }
}

module.exports = { chooseMove, proMove, searchIter, TIERS, TIER_NAMES, REACTION, MISTAKE, SILVER, GM, FEATURES, W, SEARCH, wantSearch };
