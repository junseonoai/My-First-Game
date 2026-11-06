// 4인 테이블: 시험할 단계 1명 + 상대 단계(OPP, 기본 골드) 3명. 같은 실력이면 1등 25%, 평균 순위 2.5
const { Game } = require('../game');
const { REACTION } = require('../bots');
// 원카드 버튼 경쟁: 각 봇의 반응 확률과 시간으로 가장 먼저 누른 사람을 정한다 (REACT=0이면 본인이 항상 외침)
function race(g, tierOf) {
  const target = g.oneCard.playerId;
  let best = null;
  for (const p of g.players) {
    if (p.out && p.id !== target) continue;
    const r = REACTION[tierOf(p.id)];
    const own = p.id === target;
    if (Math.random() >= (own ? r.self : r.catch)) continue;
    const [a, b] = own ? r.selfMs : r.catchMs;
    const t = a + Math.random() * (b - a);
    if (t > 2000) continue; // 버튼이 열린 뒤 2초 안에 못 누르면 실패
    if (!best || t < best.t) best = { id: p.id, t };
  }
  if (best) g.callOneCard(best.id); else g.oneCard = null;
}
const N = +process.argv[2] || 1000;
const tiers = process.argv.slice(3).length ? process.argv.slice(3) : ['silver', 'gold', 'platinum', 'master', 'grandmaster'];
const size = +process.env.TABLE || 4;
for (const t of tiers) {
  let win = 0, rankSum = 0, bank = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const seat = i % size;
    const g = new Game(Array.from({ length: size }, (_, k) => ({ id: 'p' + k, name: 'p' + k, bot: true })));
    let steps = 0;
    while (!g.finished && steps++ < 3000) {
      const cur = g.cur();
      g.botMove(cur.id, cur.id === 'p' + seat ? t : (process.env.OPP || 'gold'));
      if (g.oneCard) { if (process.env.REACT === '0') g.callOneCard(g.oneCard.playerId); else race(g, (id) => id === 'p' + seat ? t : (process.env.OPP || 'gold')); }
    }
    const me = g.find('p' + seat);
    if (me.rank === 1) win++;
    rankSum += me.rank || size;
    if (me.bankrupt) bank++;
  }
  console.log(`${t.padEnd(12)} 1등 ${(win / N * 100).toFixed(1)}%  평균순위 ${(rankSum / N).toFixed(2)}  파산 ${(bank / N * 100).toFixed(1)}%  (${((Date.now() - t0) / N).toFixed(0)}ms/판)`);
}
