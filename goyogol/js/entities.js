/* entities.js — 주민, 골짜기의 생물, 그리고 "지금 행동 버튼이 무엇을 하는가"의 판단.
 * 행동 버튼은 하나이고, 주인공 가까이에 무엇이 있느냐에 따라 대화·베기·따기·공격 등으로 바뀐다. */
'use strict';
(() => {
  const T = THREE, W = G.world, S = G.sys, D = G.DATA, U = G.ui;
  const E = G.ent = { npcs: {}, creatures: [], target: null };
  const me = () => G.player;
  const say1 = text => U.say([['나', text]]);

  /* ---------- 주민 ---------- */
  const markTex = (ch, color) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 8; x.strokeStyle = '#0f1a24'; x.strokeText(ch, 32, 36); x.fillStyle = color; x.fillText(ch, 32, 36); return new T.CanvasTexture(c); };
  let marks;
  const soriPos = () => { const q = S.quests.wake; return !q || (q.state === 'active' && q.step === 0) ? [W.spawn.x + 1.8, W.spawn.z - 1.2, -2.2] : [...D.npcs.sori.pos, D.npcs.sori.rot]; };
  E.refreshNpcs = () => {
    for (const id in E.npcs) {
      const n = E.npcs[id], mk = S.npcMark(id);
      n.mark.visible = !!mk; if (mk) n.mark.material.map = marks[mk];
      if (id === 'sori') { const [x, z, r] = soriPos(); if (n.x !== x || n.z !== z) { n.x = n.col.x = x; n.z = n.col.z = z; n.rot = n.baseRot = r; n.g.position.set(x, W.hgt(x, z), z); } }
    }
  };
  G.bus.on('quest', () => E.refreshNpcs());

  /* ---------- 생물 ---------- */
  const SPAWNS = [[-14, -8], [13, -13], [-25, -21], [11, -30], [-19, -37], [-27, -52], [13, -50], [3, -57]];
  const spawnCreature = (sx, sz) => {
    const g = G.models.creature(); W.scene.add(g);
    const c = { g, sx, sz, x: sx, z: sz, rot: Math.random() * 6.28, hp: 9, state: 'wander', t: 0, tx: sx, tz: sz, blurred: true, hop: Math.random() * 6, flash: 0, hitOnce: false };
    E.creatures.push(c); setLook(c); return c;
  };
  const setLook = c => { c.g.userData.clear.visible = !c.blurred; c.g.userData.blur.visible = c.blurred; };
  const stepTo = (c, tx, tz, sp, dt) => {
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz); if (d < .1) return true;
    c.rot += G.angDiff(c.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
    let nx = c.x + dx / d * sp * dt, nz = c.z + dz / d * sp * dt; [nx, nz] = W.resolve(nx, nz, .5);
    if (W.walkable(nx, nz)) { c.x = nx; c.z = nz; } else return true;
    return d < .4;
  };
  const calm = c => {
    c.blurred = false; setLook(c); c.state = 'happy'; c.t = 0;
    S.add('mist', Math.random() < .25 ? 2 : 1); S.addXp('combat', 10); S.onCalm();
  };
  E.nearestBlurred = (x, z, range) => { let best = null, bd = range; for (const c of E.creatures) { if (!c.blurred || c.state === 'gone') continue; const d = G.dist(x, z, c.x, c.z); if (d < bd) { bd = d; best = c; } } return best; };
  /** 주인공의 공격 판정: 앞쪽 부채꼴 안의 흐려진 생물을 때린다 */
  E.strike = (x, z, rot, range, arc, dmg) => {
    let hit = false;
    for (const c of E.creatures) {
      if (!c.blurred || c.state === 'gone') continue;
      const d = G.dist(x, z, c.x, c.z); if (d > range) continue;
      if (Math.abs(G.angDiff(rot, Math.atan2(c.x - x, c.z - z))) > arc && d > 1) continue;
      hit = true; c.hp -= dmg; c.flash = .18; S.addXp('combat', 3);
      const k = 1.3 / (d || 1); let nx = c.x + (c.x - x) * k, nz = c.z + (c.z - z) * k; if (W.walkable(nx, nz)) { c.x = nx; c.z = nz; }
      if (c.hp <= 0) calm(c); else if (c.state !== 'lunge') { c.state = 'recover'; c.t = .5; }
    }
    return hit;
  };
  /** 돌이 깨어났을 때: 숲의 생물이 모두 제 모습을 찾는다 */
  E.onAwaken = () => { for (const c of E.creatures) { c.blurred = false; setLook(c); c.state = 'pet'; c.t = 0; c.g.visible = true; c.g.scale.setScalar(1); if (!W.walkable(c.x, c.z)) { c.x = c.sx; c.z = c.sz; } } };

  const updateCreature = (c, dt, t) => {
    const p = me(), dp = G.dist(c.x, c.z, p.x, p.z); c.t += dt; c.flash = Math.max(0, c.flash - dt);
    let squash = 1, hopping = false;
    switch (c.state) {
      case 'wander': case 'pet':
        if (c.t > 0) { if (stepTo(c, c.tx, c.tz, 1.5, dt)) { c.t = -(1.5 + Math.random() * 2.5); const a = Math.random() * 6.28, r = Math.random() * (c.state === 'pet' ? 9 : 6); c.tx = c.sx + Math.cos(a) * r; c.tz = c.sz + Math.sin(a) * r; } else hopping = true; }
        if (c.state === 'wander' && dp < 8 && p.state !== 'ko' && !U.busy) { c.state = 'chase'; c.t = 0; }
        break;
      case 'chase':
        hopping = true;
        if (p.state === 'ko' || dp > 13 || G.dist(c.x, c.z, c.sx, c.sz) > 17) { c.state = 'wander'; c.tx = c.sx; c.tz = c.sz; c.t = 0; break; }
        if (dp < 2.2) { c.state = 'windup'; c.t = 0; break; }
        stepTo(c, p.x, p.z, 3.5, dt);
        break;
      case 'windup':   // 몸을 움츠려 달려들 준비 — 이때 구르면 피할 수 있다
        c.rot += G.angDiff(c.rot, Math.atan2(p.x - c.x, p.z - c.z)) * Math.min(1, dt * 10);
        squash = 1 - .35 * Math.min(1, c.t / .5);
        if (c.t > .5) { c.state = 'lunge'; c.t = 0; c.hitOnce = false; }
        break;
      case 'lunge': {
        let nx = c.x + Math.sin(c.rot) * 10 * dt, nz = c.z + Math.cos(c.rot) * 10 * dt; [nx, nz] = W.resolve(nx, nz, .5); if (W.walkable(nx, nz)) { c.x = nx; c.z = nz; }
        squash = 1.2;
        if (!c.hitOnce && dp < 1.25) { c.hitOnce = true; p.hurt(3, c.x, c.z); }
        if (c.t > .26) { c.state = 'recover'; c.t = 0; }
        break;
      }
      case 'recover': if (c.t > .9) { c.state = 'chase'; c.t = 0; } break;
      case 'happy':   // 제 모습을 찾고 기뻐 뛰다가 숲으로 달아난다
        hopping = true;
        if (c.t > 1.1) { const a = Math.atan2(c.x - p.x, c.z - p.z); stepTo(c, c.x + Math.sin(a) * 4, c.z + Math.cos(a) * 4, 5, dt); c.g.scale.setScalar(Math.max(.01, 1 - (c.t - 1.1) / 2)); }
        if (c.t > 3.1) { c.state = 'gone'; c.t = 0; c.g.visible = false; }
        break;
      case 'gone':
        if (!S.flags.stoneForest && c.t > 40 && dp > 16) { c.x = c.sx; c.z = c.sz; c.hp = 9; c.blurred = true; setLook(c); c.state = 'wander'; c.t = 0; c.g.visible = true; c.g.scale.setScalar(1); }
        return;
    }
    if (hopping) c.hop += dt * 11;
    const y = W.hgt(c.x, c.z) + (hopping ? Math.abs(Math.sin(c.hop)) * .32 : 0);
    c.g.position.set(c.x, y, c.z); c.g.rotation.y = c.rot;
    if (c.state !== 'happy') c.g.scale.set(1 + (1 - squash) * .5, squash * (c.flash > 0 ? .85 : 1), 1 + (1 - squash) * .5);
  };

  /* ---------- 행동 대상 찾기 ---------- */
  const nearest = (list, range, ok) => { const p = me(); let best = null, bd = range; for (const o of list) { if (!ok(o)) continue; const d = G.dist(p.x, p.z, o.x, o.z); if (d < bd) { bd = d; best = o; } } return best; };
  const findTarget = () => {
    const p = me(), near = (o, r) => G.dist(p.x, p.z, o.x, o.z) < r;
    for (const id in E.npcs) if (near(E.npcs[id], 2.7)) return { type: 'npc', id, label: '대화' };
    if (near(W.points.board, 2.6)) return { type: 'board', label: '게시판' };
    if (near(W.points.hut, 2.3)) return { type: 'hut', label: '쉬기' };
    if (near(W.stonePos, 5.6)) { const o = !S.flags.stoneForest && S.offerStep('forest'); return { type: 'stone', label: o ? '바치기' : '살피기' }; }
    if (E.nearestBlurred(p.x, p.z, 5)) return { type: 'attack', label: '공격' };
    /* 나무·덤불·약초 중 가장 가까운 것 (덤불과 약초는 작으니 조금 우선한다) */
    const tr = nearest(W.trees, 2.5, o => o.alive), b = nearest(W.bushes, 2.1, o => o.ripe), h = nearest(W.herbs, 1.8, o => o.ripe);
    const dd = o => (o ? G.dist(p.x, p.z, o.x, o.z) : 1e9);
    const pick = [[dd(tr), tr, 'tree', '베기'], [dd(b) - .6, b, 'node', '따기'], [dd(h) - .8, h, 'node', '캐기']].sort((x, y) => x[0] - y[0])[0];
    if (pick[1]) return { type: pick[2], ref: pick[1], label: pick[3] };
    return { type: 'attack', label: '공격' };
  };

  /** 행동 버튼을 눌렀을 때 */
  E.act = () => {
    const tg = E.target = findTarget(), p = me();
    if (tg.type === 'npc') {
      const n = E.npcs[tg.id]; n.rot = Math.atan2(p.x - n.x, p.z - n.z); p.rot = Math.atan2(n.x - p.x, n.z - p.z);
      const r = S.talk(tg.id); U.say(r.lines, () => { if (r.after) r.after(); if (r.shop) U.openShop(); });
    } else if (tg.type === 'board') U.openBoard();
    else if (tg.type === 'hut') { if (S.hp >= S.maxHp()) say1('아직 쉴 때가 아니다.'); else { S.heal(999); G.bus.emit('toast', '오두막에서 잠시 쉬었다'); S.save(); } }
    else if (tg.type === 'stone') useStone();
    else if (tg.type === 'tree') { if (S.has('axe') || S.has('axe2')) p.startSwing('chop', tg.ref); else say1('맨손으로는 벨 수 없다. 도끼가 있어야겠다.'); }
    else if (tg.type === 'node') p.startSwing('gather', tg.ref);
    else p.startSwing('attack');
  };
  const useStone = () => {
    if (S.flags.stoneForest) return say1('돌이 맑게 빛나고 있다. 곁에 서 있으면 마음이 가라앉는다.');
    const o = S.offerStep('forest');
    if (!o) return say1('이끼 낀 선돌. 빛이 꺼져 있다.\n……처음 보는데, 어쩐지 낯설지 않다.');
    if (!S.canOffer(o.s)) return say1('아직 바칠 것이 모자라다.');
    U.say([['나', '가져온 것들을 돌 앞에 내려놓았다.']], () => {
      U.flash(true);
      setTimeout(() => {
        S.doOffer(o.q, o.s); W.awaken(); E.onAwaken(); U.flash(false);
        U.memory(D.memories.forest, () => { G.bus.emit('toast', '숲 너머로 거울못 가는 옛 길이 드러났다'); S.save(); });
      }, 950);
    });
  };
  /** 나무 한 번 찍기 */
  E.chop = tr => {
    if (!tr || !tr.alive) return;
    tr.hp++; tr.shake = .3; S.addXp('logging', 3);
    if (tr.hp >= S.chopsNeeded()) { W.setTree(tr, false); tr.shake = 0; S.add('wood', 2 + (Math.random() < S.bonusChance('logging') ? 1 : 0)); S.addXp('logging', 6); }
  };
  /** 열매·약초 따기 */
  E.gather = nd => {
    if (!nd || !nd.ripe) return;
    W.setNode(nd, false); S.addXp('gathering', 5);
    S.add(nd.kind === 'bush' ? 'berry' : 'herb', (nd.kind === 'bush' ? 2 : 1) + (Math.random() < S.bonusChance('gathering') ? 1 : 0));
  };

  E.init = () => {
    marks = { '!': markTex('!', '#ffc46b'), '?': markTex('?', '#7ff0ff') };
    for (const id in D.npcs) {
      const d = D.npcs[id], g = G.models.npc(d.look); W.scene.add(g);
      const mark = new T.Sprite(new T.SpriteMaterial({ map: marks['!'], depthTest: false, fog: false })); mark.scale.setScalar(.9 / (d.look.scale || 1)); mark.position.y = 3.3; g.add(mark);
      const n = E.npcs[id] = { id, g, mark, x: d.pos[0], z: d.pos[1], rot: d.rot, baseRot: d.rot, ph: Math.random() * 6 };
      n.col = { x: n.x, z: n.z, r: .55 }; W.colliders.push(n.col); g.position.set(n.x, W.hgt(n.x, n.z), n.z);
    }
    for (const [x, z] of SPAWNS) spawnCreature(x, z);
  };
  /** 새 게임/이어하기 직후 상태 맞추기 */
  E.sync = () => {
    E.refreshNpcs();
    for (const c of E.creatures) { c.x = c.sx; c.z = c.sz; c.hp = 9; c.blurred = !S.flags.stoneForest; c.state = c.blurred ? 'wander' : 'pet'; c.t = 0; c.g.visible = true; c.g.scale.setScalar(1); setLook(c); }
    for (const tr of W.trees) if (!tr.alive) W.setTree(tr, true);
    for (const nd of W.bushes.concat(W.herbs)) if (!nd.ripe) W.setNode(nd, true);
    W.setMood(S.flags.stoneForest ? 1 : 0);
  };
  E.update = (dt, t) => {
    const p = me();
    for (const id in E.npcs) {
      const n = E.npcs[id], near = G.dist(p.x, p.z, n.x, n.z) < 6;
      n.g.rotation.y += G.angDiff(n.g.rotation.y, near ? Math.atan2(p.x - n.x, p.z - n.z) : n.baseRot) * Math.min(1, dt * 4);
      n.g.userData.body.position.y = Math.sin(t * 1.8 + n.ph) * .03; n.mark.position.y = 3.3 + Math.sin(t * 3 + n.ph) * .08;
    }
    for (const c of E.creatures) updateCreature(c, dt, t);
    for (const tr of W.trees) if (tr.shake > 0) { tr.shake -= dt; W.shakeTree(tr, Math.max(0, tr.shake)); }
    if (!U.busy) { E.target = findTarget(); U.setAction(E.target.label); }
  };
})();
