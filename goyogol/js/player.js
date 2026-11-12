/* player.js — 주인공의 움직임과 3인칭 카메라.
 * 상태(state): 'free' 자유 이동 · 'roll' 구르기(무적) · 'swing' 휘두르기(공격/벌목/채집) · 'ko' 쓰러짐 */
'use strict';
(() => {
  const T = THREE, W = G.world, S = G.sys, I = G.input;
  const SPEED = 6.2, ROLL_TIME = .45, SWING_TIME = .34, HIT_AT = .16;
  const P = G.player = { x: 0, z: 0, y: 0, rot: Math.PI, state: 'free', t: 0, walk: 0, invuln: 0, moving: false, combo: 0, queued: false, hitDone: false, swing: null, warnT: 0 };
  const C = G.cam = { yaw: Math.PI, pitch: .5, dist: 8.5 };

  P.init = scene => {
    P.m = G.models.hero(); scene.add(P.m.root);
    C.obj = new T.PerspectiveCamera(55, innerWidth / innerHeight, .1, 900);
  };
  P.place = (x, z, rot) => { P.x = x; P.z = z; P.rot = rot == null ? P.rot : rot; P.state = 'free'; P.t = 0; C.yaw = P.rot; };

  /** 장애물과 지형을 따져 가며 (dx, dz) 만큼 움직인다 */
  const move = (dx, dz) => {
    let nx = P.x + dx, nz = P.z + dz;
    if (!W.walkable(nx, nz)) { if (W.walkable(nx, P.z)) nz = P.z; else if (W.walkable(P.x, nz)) nx = P.x; else return; }
    [nx, nz] = W.resolve(nx, nz, .45);
    if (W.walkable(nx, nz)) { P.x = nx; P.z = nz; }
  };
  const face = (ang, dt, rate = 14) => { P.rot += G.angDiff(P.rot, ang) * Math.min(1, dt * rate); };

  /** 휘두르기 시작. kind: 'attack' | 'chop' | 'gather', target: 맞힐 대상(나무·덤불) */
  P.startSwing = (kind, target) => {
    P.state = 'swing'; P.t = 0; P.hitDone = false; P.queued = false; P.swing = { kind, target };
    if (kind === 'attack') { P.combo = P.combo % 3 + 1; const c = G.ent.nearestBlurred(P.x, P.z, 5.5); if (c) P.rot = Math.atan2(c.x - P.x, c.z - P.z); }
    else if (target) P.rot = Math.atan2(target.x - P.x, target.z - P.z);
  };
  P.hurt = (dmg, fx, fz) => {
    if (P.invuln > 0 || P.state === 'roll' || P.state === 'ko') return false;
    S.hp -= dmg; P.invuln = .8; S.addXp('tough', 6); G.bus.emit('hud');
    const d = Math.hypot(P.x - fx, P.z - fz) || 1; move((P.x - fx) / d * 1.2, (P.z - fz) / d * 1.2);
    if (S.hp <= 0) { P.state = 'ko'; P.t = 0; G.bus.emit('toast', '눈앞이 흐려진다…'); }
    return true;
  };

  P.update = (dt, t) => {
    const m = P.m; P.t += dt; P.invuln = Math.max(0, P.invuln - dt); P.warnT = Math.max(0, P.warnT - dt);
    let moving = false, armR = -.35, staff = 0, armL = 0, tilt = 0, bodyY = 0;

    if (P.state === 'ko') {
      tilt = Math.min(1.5, P.t * 4);
      if (P.t > 1.8) { const r = W.respawn; P.place(r.x, r.z, Math.PI / 2); S.hp = S.maxHp(); G.bus.emit('hud'); G.bus.emit('toast', '오두막에서 눈을 떴다'); S.save(); }
    } else if (G.ui.busy) {
      /* 대화나 창이 열려 있으면 가만히 선다 */
    } else if (P.state === 'roll') {
      const k = P.t / ROLL_TIME, sp = G.lerp(12, 6, k);
      move(Math.sin(P.rot) * sp * dt, Math.cos(P.rot) * sp * dt);
      tilt = k * Math.PI * 2; bodyY = -.35 * Math.sin(k * Math.PI);
      if (P.t >= ROLL_TIME) { P.state = 'free'; tilt = 0; }
    } else if (P.state === 'swing') {
      const k = P.t / SWING_TIME, sw = P.swing;
      if (I.action && P.t > .1) P.queued = true;
      /* 올렸다가 내리친다 */
      if (P.t < HIT_AT) { const a = P.t / HIT_AT; armR = G.lerp(-.35, -2.0, a); staff = G.lerp(0, 1.4, a); }
      else { const a = G.clamp((P.t - HIT_AT) / .08, 0, 1), b = G.ss(.7, 1, k); armR = G.lerp(G.lerp(-2.0, -1.0, a), -.35, b); staff = G.lerp(G.lerp(1.4, 2.7, a), 0, b); }
      if (sw.kind === 'attack' && P.t < HIT_AT) move(Math.sin(P.rot) * 3 * dt, Math.cos(P.rot) * 3 * dt);
      if (!P.hitDone && P.t >= HIT_AT) {
        P.hitDone = true;
        if (sw.kind === 'attack') G.ent.strike(P.x, P.z, P.rot, 2.6, 1.25, S.damage() + (P.combo === 3 ? 2 : 0));
        else if (sw.kind === 'chop') G.ent.chop(sw.target);
        else G.ent.gather(sw.target);
      }
      if (P.t >= SWING_TIME) { P.state = 'free'; if (P.queued) G.ent.act(); else P.combo = 0; }
    } else {
      /* 자유 이동: 입력은 카메라 방향 기준 */
      const fx = Math.sin(C.yaw), fz = Math.cos(C.yaw);
      const dx = fx * I.mz - fz * I.mx, dz = fz * I.mz + fx * I.mx, mag = Math.hypot(dx, dz);
      if (mag > .12) { moving = true; face(Math.atan2(dx, dz), dt); move(dx * SPEED * dt, dz * SPEED * dt); P.walk += mag * SPEED * dt * 1.5; }
      if (I.roll) { if (mag > .12) P.rot = Math.atan2(dx, dz); P.state = 'roll'; P.t = 0; S.addXp('tough', 1); }
      else if (I.action) G.ent.act();
      /* 길 끝에서의 안내 */
      if (P.z < W.northLimit() + 2.5 && P.warnT <= 0) { P.warnT = 6; G.bus.emit('toast', S.flags.stoneForest ? '거울못으로 가는 옛 길이다. 이야기는 여기서부터 이어진다.' : '짙은 안개가 길을 막고 있다.'); }
    }
    P.moving = moving;

    /* ----- 자세 ----- */
    P.y = W.hgt(P.x, P.z);
    m.root.position.set(P.x, P.y, P.z); m.root.rotation.y = P.rot;
    m.root.visible = !(P.invuln > 0 && Math.floor(P.invuln * 16) % 2);
    const sw = moving ? Math.sin(P.walk) : 0, idle = Math.sin(t * 2) * .03;
    m.legL.rotation.x = sw * .75; m.legR.rotation.x = -sw * .75;
    m.armL.rotation.x = -sw * .6 + armL; m.armR.rotation.x = armR + (moving ? sw * .15 : 0); m.staff.rotation.x = staff;
    m.rig.rotation.x = tilt; m.rig.position.y = .9 + bodyY + (moving ? Math.abs(Math.cos(P.walk)) * .06 : idle);
    m.head.rotation.x = moving ? 0 : idle;
    m.core.rotation.y = t * 2; m.light.intensity = (4 + (S.flags.stoneForest ? 2.5 : 0)) * (1 + Math.sin(t * 3) * .08);

    /* ----- 카메라 ----- */
    C.yaw += I.camDX * .006; C.pitch = G.clamp(C.pitch + I.camDY * .004, .12, 1.15); C.dist = G.clamp(C.dist + I.zoom * .8, 4.5, 14);
    if (moving && t - I.lastDrag > 1.2) C.yaw += Math.sin(G.angDiff(C.yaw, P.rot)) * .9 * dt;   // 걷는 방향으로 천천히 따라 돈다
    const cp = Math.cos(C.pitch), tx = P.x, ty = P.y + 1.7, tz = P.z;
    /* 카메라와 주인공 사이에 집·돌 같은 큰 장애물이 있으면 그 앞까지만 물러난다 */
    let want = C.dist;
    for (let d = 1.5; d <= C.dist; d += .5) {
      const sx = tx - Math.sin(C.yaw) * cp * d, sz = tz - Math.cos(C.yaw) * cp * d;
      if (W.colliders.some(c => c.r >= 1.4 && !c.off && Math.hypot(sx - c.x, sz - c.z) < c.r + 1.4)) { want = Math.max(2.5, d - .5); break; }
    }
    C.cur = C.cur == null ? want : (want < C.cur ? want : G.lerp(C.cur, want, Math.min(1, dt * 4)));
    let cx = tx - Math.sin(C.yaw) * cp * C.cur, cz = tz - Math.cos(C.yaw) * cp * C.cur, cy = ty + Math.sin(C.pitch) * C.cur;
    cy = Math.max(cy, W.hgt(cx, cz) + .8);
    C.obj.position.set(cx, cy, cz); C.obj.lookAt(tx, ty, tz);
    W.clearView(cx, cz, P.x, P.z);
  };
})();
