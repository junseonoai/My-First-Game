/* 자동 시험: 1장을 처음부터 끝까지 진행해 보고, 저장·이어하기와 쓰러짐까지 확인한다.
 * 실행:  node goyogol/tools/smoke.js      (Playwright 와 Chromium 이 있어야 한다)
 * 화면을 그리지 않고 G.debug.step() 으로 게임만 빠르게 돌리므로 GPU 없는 환경에서도 된다. */
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let failed = 0;
  const check = (name, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) failed++; };
  const act = (n = 1, frames = 30) => p.evaluate(([n, frames]) => { for (let i = 0; i < n; i++) { if (G.ui.dialogOpen) G.ui.next(); else if (G.ui.memoryOpen) G.ui.memoryNext(); else { G.input.action = true; G.debug.step(1); } G.debug.step(frames); } }, [n, frames]);
  const tp = (x, z) => p.evaluate(([x, z]) => { G.debug.tp(x, z); G.debug.step(2); }, [x, z]);
  const q = id => p.evaluate(id => (G.sys.quests[id] || {}).state, id);
  const inv = id => p.evaluate(id => G.sys.count(id), id);
  const talk = async (npc, presses) => { const [x, z] = await p.evaluate(n => G.DATA.npcs[n].pos, npc); await tp(x + 1.6, z + .4); await act(presses); };

  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html')); await p.waitForTimeout(2000);
  await p.click('#btnNew'); await p.waitForTimeout(200); await act(2);
  await act(5);                                   // 소리와 첫 대화
  await p.evaluate(() => { dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); G.debug.step(60); dispatchEvent(new KeyboardEvent('keyup', { key: 'w' })); });
  check('걷기', await p.evaluate(() => G.player.z < 2));
  await talk('bau', 4); check('낯선 골짜기 완료', await q('wake') === 'done');
  await talk('dodam', 3); check('도끼 받음', await inv('axe') === 1);
  const trees = await p.evaluate(() => G.world.trees.filter(t => Math.hypot(t.x - 4, t.z + 2) < 16).slice(0, 4).map(t => [t.x, t.z]));
  for (const [x, z] of trees) { await tp(x + 1.3, z + 1.3); await act(6); }
  check('벌목', await inv('wood') >= 6);
  await talk('dodam', 4); check('도담의 일손 완료', await q('wood') === 'done');
  await talk('sori', 3);
  const bushes = await p.evaluate(() => G.world.bushes.slice(0, 6).map(t => [t.x, t.z]));
  for (const [x, z] of bushes) { if (await inv('berry') >= 5) break; await tp(x + 1.1, z + 1.1); await act(1); }
  check('채집', await inv('berry') >= 5);
  await talk('sori', 2); check('소리의 열매즙 완료', await q('berry') === 'done');
  await talk('bau', 4);
  for (let i = 0; i < 8 && await p.evaluate(() => G.sys.quests.calm.step === 0); i++) {
    const c = await p.evaluate(() => { const c = G.ent.creatures.find(c => c.blurred && c.state !== 'gone'); return c ? [c.x, c.z] : null; });
    if (!c) break; await tp(c[0] + 2, c[1] + 2); await act(14, 22);
  }
  check('생물 달래기', await p.evaluate(() => G.sys.quests.calm.step === 1));
  await talk('bau', 3); check('흐려진 것들 완료', await q('calm') === 'done');
  await talk('hangyeol', 4); check('잠든 돌 시작', await q('stone') === 'active');
  await p.evaluate(() => { for (const k of ['wood', 'berry', 'mist']) G.sys.add(k, 5, true); });
  await tp(-6, -41.5); await act(2, 5); await p.waitForTimeout(1300);
  check('돌이 깨어남', await p.evaluate(() => G.sys.flags.stoneForest === true && G.ui.memoryOpen));
  await act(5, 5); await p.evaluate(() => G.debug.step(300));
  check('분위기 전환', await p.evaluate(() => G.world.mood === 1 && G.ent.creatures.every(c => !c.blurred)));
  await talk('hangyeol', 5); check('잠든 돌 완료', await q('stone') === 'done');
  await p.evaluate(() => G.sys.save()); const coins = await p.evaluate(() => G.sys.coins);
  await p.reload(); await p.waitForTimeout(2000); await p.click('#btnContinue'); await p.waitForTimeout(300);
  check('이어하기', await p.evaluate(c => G.sys.coins === c && G.sys.flags.stoneForest && G.world.mood === 1, coins));
  await p.evaluate(() => { G.player.hurt(999, 0, 0); G.debug.step(150); });
  check('쓰러진 뒤 오두막에서 깨어남', await p.evaluate(() => G.sys.hp === G.sys.maxHp() && G.player.state === 'free'));
  check('스크립트 오류 없음', errors.length === 0); errors.forEach(e => console.log('  ' + e));
  await b.close();
  console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
})();
