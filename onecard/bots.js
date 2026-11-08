// 원카드 봇 5단계: 실버 · 골드 · 플래티넘 · 마스터 · 그랜드마스터
//
// 모든 봇은 사람이 볼 수 있는 정보만 쓴다: 내 손패, 바닥에 나온 카드, 각자 손패 장수,
// 누가 카드를 못 내고 뽑았는지(그때 없던 무늬). 다른 사람 손패를 훔쳐보지 않는다.
//
// 실버        낼 수 있는 카드 중 아무거나. 가끔 기회를 놓친다.
// 골드        공격 카드 먼저, 같은 숫자는 몰아서 (예전 기본 봇).
// 플래티넘    공격 카드와 조커를 아꼈다가 받아치는 데 쓴다 (시뮬레이션으로 찾은 가장 큰 요령).
// 마스터      플래티넘 + 카드 기억과 추리: 이기기 직전인 사람 끊기, 7로 바꿀 무늬 고르기.
// 그랜드마스터 마스터의 판단 + 가장 빠르고 정확한 원카드 반응.
//
// 보이지 않는 손패를 추측해 끝까지 둬 보는 검색(몬테카를로)도 시험했지만 마스터보다 이기지 못했다.
// 이 게임은 운의 비중이 커서, 마스터 수준을 넘는 수 선택은 승률을 거의 바꾸지 못한다.
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

function chooseMove(g, botId, tier) {
  const me = g.find(botId);
  if (!me || me.out) return { draw: true };
  if (MISTAKE[tier] && Math.random() < MISTAKE[tier] && me.hand.some((c) => g.canPlay(c))) return sloppyMove(g, me);
  switch (tier) {
    case 'silver': return silverMove(g, me);
    case 'platinum': return planMove(g, botId, false);
    case 'master': return planMove(g, botId, true);
    case 'grandmaster': case 'challenger': return gmMove(g, botId);
    default: return g.goldMove(botId);
  }
}

module.exports = { chooseMove, TIERS, TIER_NAMES, REACTION, MISTAKE, SILVER, GM };
