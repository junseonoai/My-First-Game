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

const TIERS = ['silver', 'gold', 'platinum', 'master', 'grandmaster'];
const TIER_NAMES = { silver: '실버', gold: '골드', platinum: '플래티넘', master: '마스터', grandmaster: '그랜드마스터' };

// 원카드 버튼 반응: 내 원카드를 외칠 확률과 시간, 남의 원카드를 잡을 확률과 시간 (ms)
const REACTION = {
  silver: { self: 0.55, selfMs: [3000, 5500], catch: 0.35, catchMs: [5000, 8000] },
  gold: { self: 0.8, selfMs: [1800, 3500], catch: 0.6, catchMs: [3500, 6000] },
  platinum: { self: 0.92, selfMs: [1200, 2400], catch: 0.8, catchMs: [2500, 4500] },
  master: { self: 0.97, selfMs: [800, 1600], catch: 0.9, catchMs: [1600, 3000] },
  grandmaster: { self: 1, selfMs: [500, 1000], catch: 0.98, catchMs: [900, 1800] },
};

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

// 실버: 아무 카드나. 공격을 받아도 그냥 먹거나, 낼 수 있는데 뽑기도 한다
function silverMove(g, me) {
  const playable = me.hand.filter((c) => g.canPlay(c));
  if (!playable.length) return { draw: true };
  if (g.penalty > 0 && Math.random() < 0.3) return { draw: true };
  if (g.penalty === 0 && Math.random() < 0.12) return { draw: true };
  const c = playable[Math.floor(Math.random() * playable.length)];
  return { ids: [c.id], suit: c.rank === '7' && g.penalty === 0 ? SUITS[Math.floor(Math.random() * 4)] : undefined };
}

// 플래티넘·마스터
//  - 공격 카드(2, A)와 조커는 아꼈다가 공격받을 때 받아치는 데 쓴다
//  - 받아칠 때는 싼 카드부터 (2 → A → A♠), 3은 막기용으로 남긴다
//  - 같은 숫자는 몰아서 낸다
// 마스터(smart)는 여기에 카드 기억과 상대 추리를 더한다
//  - 다음 사람이 한 장 남았으면 아껴 둔 공격으로 끊는다
//  - 7로 무늬를 바꿀 때 아직 많이 남은 무늬(상대가 가졌을 법한 무늬)는 피하고, 다음 사람에게 없는 무늬를 고른다
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
  const card = playable[0];
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
  let suit;
  if (card.rank === '7' && g.penalty === 0) {
    const used = new Set(ids);
    const val = {};
    for (const s of SUITS) val[s] = 0;
    for (const c of p.hand) if (!used.has(c.id) && SUITS.includes(c.suit)) val[c.suit] += attackValue(c) > 0 ? 0.5 : 1;
    if (smart) {
      const unseen = unseenCards(g, p);
      for (const s of SUITS) val[s] -= 0.12 * unseen.filter((c) => c.suit === s).length;
      if (next && g.voids[next.id]) val[g.voids[next.id]] += next.hand.length <= 3 ? 2 : 0.8;
    }
    suit = SUITS.slice().sort((a, b) => val[b] - val[a])[0];
  }
  return { ids, suit };
}

function chooseMove(g, botId, tier) {
  const me = g.find(botId);
  if (!me || me.out) return { draw: true };
  switch (tier) {
    case 'silver': return silverMove(g, me);
    case 'platinum': return planMove(g, botId, false);
    case 'master':
    case 'grandmaster': return planMove(g, botId, true);
    default: return g.goldMove(botId);
  }
}

module.exports = { chooseMove, TIERS, TIER_NAMES, REACTION };
