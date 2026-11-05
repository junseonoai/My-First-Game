// 봇끼리 많은 판을 돌려 규칙 엔진이 멈추거나 카드가 사라지지 않는지 확인
const assert = require('assert');
const { Game } = require('../game');
let bankrupt = 0, turnsTotal = 0, capped = 0;
const N = 3000;
for (let n = 0; n < N; n++) {
  const k = 2 + (n % 5);
  const g = new Game(Array.from({ length: k }, (_, i) => ({ id: 'p' + i, name: 'P' + i, bot: true })));
  let turns = 0;
  while (!g.finished) {
    const cur = g.cur();
    assert(!cur.out, 'turn on out player');
    const res = g.botMove(cur.id);
    assert(res.ok, res.error);
    if (g.oneCard && Math.random() < 0.5) g.callOneCard(g.players[Math.floor(Math.random() * k)].id);
    const total = g.deck.length + g.discard.length + g.players.reduce((a, p) => a + p.hand.length, 0);
    assert.strictEqual(total, 54, 'card count');
    assert(++turns < 2000, 'game too long');
  }
  const ranks = g.players.map((p) => p.rank).filter(Boolean).sort();
  assert.strictEqual(new Set(ranks).size, ranks.length, 'unique ranks');
  if (g.log.some((l) => l.includes('턴이 지났어요'))) capped++;
  bankrupt += g.players.filter((p) => p.bankrupt).length;
  turnsTotal += turns;
}
// 규칙 단위 확인
const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
g.discard.push({ id: 900, suit: 'H', rank: '2' }); g.penalty = 2; g.activeSuit = 'H';
assert(g.canPlay({ suit: 'H', rank: '3' }), '3 defends 2');
assert(!g.canPlay({ suit: 'S', rank: '3' }), 'wrong-suit 3');
assert(g.canPlay({ suit: 'C', rank: '2' }), '2 on 2');
assert(g.canPlay({ suit: 'H', rank: 'A' }), 'A same suit');
assert(!g.canPlay({ suit: 'H', rank: '5' }), 'normal under attack');
assert(g.canPlay({ suit: 'BJ', rank: 'JOKER' }), 'joker');
console.log(`ok — ${N}판, 평균 ${(turnsTotal / N).toFixed(1)}턴, 파산 ${bankrupt}명, 턴제한 종료 ${capped}판`);
