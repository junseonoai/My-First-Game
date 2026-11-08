// 모의 게임 검색 (마스터·그랜드마스터·챌린저)
//
// 봇은 남의 손패를 모른다. 그래서 공개된 정보(바닥에 나온 카드, 각자 손패 장수, 누가 어떤 무늬에서
// 뽑기만 했는지)로 남의 손패를 그럴듯하게 가정하고, 지금 낼 수 있는 수마다 판을 끝까지 빠르게 둬 본다.
// 가장 자주 1등을 하는 수를 고른다. 원카드 버튼 경쟁도 각자 등급의 반응 속도로 흉내 낸다.
//
// 계산은 한 번에 다 하지 않고 조금씩 나눠서 한다(제너레이터). 서버는 조각 사이사이에 다른 방의
// 카드 내기·원카드 버튼·연결 확인을 처리하므로 판이 끊기거나 접속이 튕기지 않는다.

const { Game, attackValue, isJoker, SUITS, makeDeck } = require('./game');

const FULL = makeDeck();
const noop = () => {};

// 판을 가볍게 복사 (기록은 남기지 않는다)
function cloneGame(g) {
  const c = Object.create(Game.prototype);
  c.players = g.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, tier: p.tier, hand: p.hand.slice(), out: p.out, rank: p.rank, bankrupt: p.bankrupt }));
  c.deck = g.deck.slice();
  c.discard = g.discard.slice();
  c.dir = g.dir; c.turn = g.turn; c.penalty = g.penalty; c.activeSuit = g.activeSuit;
  c.oneCard = g.oneCard ? { playerId: g.oneCard.playerId } : null;
  c.finished = g.finished; c.nextRank = g.nextRank;
  c.voids = { ...g.voids };
  c.lacks = {}; if (g.lacks) for (const k in g.lacks) c.lacks[k] = { ...g.lacks[k] };
  c.turns = g.turns || 0; c.stall = g.stall || 0; c.moves = g.moves || 0;
  c.log = []; c.addLog = noop;
  return c;
}

function shuffleInPlace(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// 남의 손패 가정: 내가 못 본 카드(덱 + 남들 손패)를 섞어서, 각자 장수만큼 나눠 준다.
// 어떤 무늬에서 뽑기만 한 사람에게는 그 무늬를 되도록 주지 않는다.
function determinize(g, meId, rnd) {
  const c = cloneGame(g);
  const me = c.players.find((p) => p.id === meId);
  const known = new Set([...me.hand, ...c.discard].map((x) => x.id));
  const pool = shuffleInPlace(FULL.filter((x) => !known.has(x.id)), rnd);
  for (const p of c.players) {
    if (p.id === meId || p.out) continue;
    const need = p.hand.length;
    const L = g.lacks && g.lacks[p.id];
    // 그때 없던 카드인가 (그 뒤 새로 뽑은 장수만큼은 제한 없이)
    const bad = L ? (x) => (L.joker && isJoker(x)) || (L.suit && x.suit === L.suit) || (L.rank && x.rank === L.rank)
      || (L.atkSuit && attackValue(x) > 0 && (x.suit === L.atkSuit || x.rank === L.atkRank)) || (L.block && x.rank === '3' && x.suit === L.block)
      || (L.atkSpadeA && x.rank === 'A' && x.suit === 'S') : null;
    const restricted = L ? Math.min(L.n, need) : 0;
    const hand = [];
    for (let i = 0; i < pool.length && hand.length < restricted; ) {
      if (bad(pool[i])) { i++; continue; }
      hand.push(pool.splice(i, 1)[0]);
    }
    while (hand.length < need && pool.length) hand.push(pool.pop());
    p.hand = hand;
  }
  c.deck = pool; // 남은 카드가 덱 (순서도 섞인 상태)
  return c;
}

// 모의 게임 안에서 쓰는 빠른 판단 (모두 같은 수준: 공격·조커 아끼기, 같은 숫자 몰기, 위험한 다음 사람 끊기)
function fastMove(g, p) {
  const top = g.discard[g.discard.length - 1];
  let best = null, bestV = -1e9;
  const n = g.players.length;
  let ni = g.turn; let next = null;
  for (let k = 0; k < n; k++) { ni = (ni + g.dir + n) % n; if (!g.players[ni].out) { next = g.players[ni]; break; } }
  const h = p.hand;
  // 남은 카드가 모두 같은 숫자면 한 번에 내서 끝낸다 (원카드 상황을 건너뜀)
  if (g.penalty === 0 && h.length > 1 && !isJoker(h[0]) && h.every((x) => x.rank === h[0].rank)) {
    const f = h.find((x) => g.canPlay(x));
    if (f) return { ids: [f.id, ...h.filter((x) => x.id !== f.id).map((x) => x.id)], suit: f.rank === '7' ? h[h.length - 1].suit : undefined };
  }
  const small = h.length <= 4;
  for (const c of p.hand) {
    if (!g.canPlay(c)) continue;
    let v;
    if (g.penalty > 0) v = isJoker(c) ? 10 : g.isBlock(c) ? 30 : 50 - attackValue(c);
    else if (next && next.hand.length <= 1 && (attackValue(c) > 0 || isJoker(c))) v = 45 + attackValue(c);
    else if (isJoker(c)) v = 5;
    else if (attackValue(c) > 0) v = 8;
    else if (c.rank === '3') v = 12;
    else if (c.rank === '7') v = 10;
    else if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') v = 30;
    else v = 20;
    // 손패가 적으면 같은 숫자 짝은 깨지 않는다 (나중에 한 번에 끝내려고)
    if (small && g.penalty === 0 && !isJoker(c)) { let k = 0; for (const x of h) if (x.rank === c.rank) k++; if (k >= 2 && k < h.length) v -= 9; }
    if (v > bestV) { bestV = v; best = c; }
  }
  if (!best) return null;
  const ids = [best.id];
  if (!isJoker(best)) for (const x of p.hand) if (x.id !== best.id && x.rank === best.rank) ids.push(x.id);
  let suit;
  if (best.rank === '7' && g.penalty === 0) {
    const cnt = { S: 0, H: 0, D: 0, C: 0 };
    for (const x of p.hand) if (!ids.includes(x.id) && cnt[x.suit] !== undefined) cnt[x.suit]++;
    suit = SUITS.reduce((a, b) => (cnt[b] > cnt[a] ? b : a), 'S');
  }
  return { ids, suit };
}

// 골드 버릇 (실제 골드 봇과 같은 판단): 공격 카드 먼저, J·Q·K, 7은 나중, 조커는 공격받을 때
function goldFast(g, p) {
  let best = null, bestV = -1;
  for (const c of p.hand) {
    if (!g.canPlay(c)) continue;
    const v = isJoker(c) ? (g.penalty > 0 ? 50 : 5) : attackValue(c) > 0 ? 40 : (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') ? 30 : c.rank === '7' ? 10 : 20;
    if (v > bestV) { bestV = v; best = c; }
  }
  if (!best) return null;
  const ids = [best.id];
  if (!isJoker(best)) for (const x of p.hand) if (x.id !== best.id && x.rank === best.rank) ids.push(x.id);
  let suit;
  if (best.rank === '7') {
    const cnt = { S: 0, H: 0, D: 0, C: 0 };
    for (const x of p.hand) if (x.id !== best.id && cnt[x.suit] !== undefined) cnt[x.suit]++;
    suit = SUITS.reduce((a, b) => (cnt[b] > cnt[a] ? b : a), 'S');
  }
  return { ids, suit };
}
// 실버 버릇: 아무거나
function silverFast(g, p, rnd) {
  const pl = p.hand.filter((c) => g.canPlay(c));
  if (!pl.length || (g.penalty > 0 && rnd() < 0.15)) return null;
  const c = pl[Math.floor(rnd() * pl.length)];
  const ids = [c.id];
  if (!isJoker(c) && rnd() < 0.85) for (const x of p.hand) if (x.id !== c.id && x.rank === c.rank) ids.push(x.id);
  return { ids, suit: c.rank === '7' && g.penalty === 0 ? SUITS[Math.floor(rnd() * 4)] : undefined };
}
const POLICY = { silver: (g, p, r) => silverFast(g, p, r), gold: (g, p) => goldFast(g, p) };

// 원카드 버튼 경쟁 흉내: 각자 등급의 반응 확률·시간으로 가장 먼저 누른 사람
function simRace(g, reactionOf, rnd) {
  const target = g.oneCard.playerId;
  let best = null, bt = 1e9;
  for (const p of g.players) {
    if (p.out && p.id !== target) continue;
    const r = reactionOf(p.id);
    const own = p.id === target;
    if (rnd() >= (own ? r.self : r.catch)) continue;
    const [a, b] = own ? r.selfMs : r.catchMs;
    const t = a + rnd() * (b - a);
    if (t <= 2000 && t < bt) { bt = t; best = p.id; }
  }
  if (best) g.callOneCard(best); else g.oneCard = null;
}

// 끝까지(또는 depth만큼) 둬 보고 점수: 1등 1, 2등 조금. 중간에 멈추면 손패 장수로 어림
function rollout(c, meId, reactionOf, rnd, depth, tierOf) {
  const me = c.players.find((p) => p.id === meId);
  if (c.oneCard) simRace(c, reactionOf, rnd);
  for (let s = 0; s < depth && !c.finished && !me.out; s++) {
    const p = c.players[c.turn];
    const pol = POLICY[tierOf(p.id)];
    const mv = pol ? pol(c, p, rnd) : fastMove(c, p);
    if (mv) c.play(p.id, mv.ids, mv.suit); else c.draw(p.id);
    if (c.oneCard) simRace(c, reactionOf, rnd);
  }
  if (me.out) return me.rank === 1 ? 1 : me.bankrupt ? 0 : me.rank === 2 ? 0.15 : 0.05;
  // 아직 안 끝났으면: 남들 중 가장 적은 손패와 비교
  let minO = 99;
  for (const p of c.players) if (p.id !== meId && !p.out) minO = Math.min(minO, p.hand.length);
  const d = minO - me.hand.length;
  return 1 / (1 + Math.exp(-0.6 * d)) * 0.8;
}

// 지금 낼 수 있는 수 목록: 카드별(같은 숫자는 몰아서, 마지막에 남길 카드를 바꿔 가며), 7은 무늬별, 뽑기
function candidates(g, me) {
  const out = [];
  const seen = new Set();
  const push = (ids, suit) => {
    const key = ids.slice(0, -1).slice().sort((a, b) => a - b).join(',') + '|' + ids[ids.length - 1] + '|' + (suit || '');
    if (seen.has(key)) return;
    seen.add(key); out.push({ ids, suit });
  };
  for (const c of me.hand) {
    if (!g.canPlay(c)) continue;
    const group = isJoker(c) ? [c] : me.hand.filter((x) => x.rank === c.rank);
    // c를 먼저 내고 나머지를 따라 낸다. 마지막 카드는 각각 한 번씩
    const rest = group.filter((x) => x.id !== c.id);
    const orders = rest.length ? rest.map((last) => [c.id, ...rest.filter((x) => x.id !== last.id).map((x) => x.id), last.id]) : [[c.id]];
    for (const ids of orders) {
      const lastCard = me.hand.find((x) => x.id === ids[ids.length - 1]);
      if (c.rank === '7' && g.penalty === 0 && !isJoker(c)) for (const s of SUITS) push(ids, s);
      else push(ids, undefined);
      void lastCard;
    }
  }
  if (out.length) out.push({ draw: true });
  return out;
}

// 같은 씨앗이면 같은 난수 (후보끼리 같은 조건에서 비교하려고)
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 검색 (제너레이터): yield 할 때마다 잠깐 쉬어 갈 수 있다. 끝나면 고른 수를 돌려준다.
//  opts: { samples, depth, reactionOf, prior, margin, chunk }
//  - 가정한 판 하나(samples개)마다 모든 후보를 같은 난수로 끝까지 둬 본다 → 운의 차이가 지워진다
//  - prior(기본 판단이 고른 수)는 다른 수가 margin 이상 확실히 나을 때만 바꾼다
function* searchGen(g, meId, opts) {
  const me = g.players.find((p) => p.id === meId);
  const cands = candidates(g, me);
  if (cands.length <= 1) return cands[0] || { draw: true };
  const S = opts.samples; const depth = opts.depth || 160; const chunk = opts.chunk || 4;
  const key = (m) => (m.draw ? 'draw' : m.ids.join(',') + '|' + (m.suit || ''));
  let pi = opts.prior ? cands.findIndex((m) => key(m) === key(opts.prior)) : -1;
  if (opts.prior && pi < 0) { cands.push(opts.prior); pi = cands.length - 1; } // 기본 판단의 수는 꼭 후보에 넣는다
  const w = cands.map(() => 0);
  for (let s = 0; s < S; s++) {
    const seed = (Math.random() * 4294967296) >>> 0;
    const base = opts.peek ? (() => { const c = cloneGame(g); shuffleInPlace(c.deck, mulberry(seed)); return c; })() : determinize(g, meId, mulberry(seed)); // peek: 측정 전용 (남의 패를 안다고 가정한 천장). 실제 게임에서는 절대 쓰지 않는다
    for (let k = 0; k < cands.length; k++) {
      const c = cloneGame(base);
      const mv = cands[k];
      const res = mv.draw ? c.draw(meId) : c.play(meId, mv.ids, mv.suit);
      w[k] += res && res.ok === false ? 0 : rollout(c, meId, opts.reactionOf, mulberry(seed ^ 0x9e3779b9), depth, opts.tierOf || (() => 'fast'));
    }
    if ((s + 1) % chunk === 0) yield s + 1;
  }
  let bk = pi >= 0 ? pi : 0;
  const margin = (opts.margin == null ? 0.03 : opts.margin) * S;
  for (let k = 0; k < cands.length; k++) if (w[k] > w[bk] + (k === pi || bk !== pi ? 0 : margin)) bk = k;
  return cands[bk];
}

// 한 번에 끝까지 (시뮬레이션·시험용)
function searchSync(g, meId, opts) {
  const it = searchGen(g, meId, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

module.exports = { searchGen, searchSync, cloneGame, determinize, candidates };
