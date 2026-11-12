/* main.js — 시작점: 렌더러를 만들고, 월드를 짓고, 제목 화면을 거쳐 게임 루프를 돌린다. */
'use strict';
(() => {
  const T = THREE, W = G.world, S = G.sys, U = G.ui, P = G.player, E = G.ent, I = G.input;
  const canvas = document.getElementById('c');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();

  W.build(scene); P.init(scene); E.init();
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); G.cam.obj.aspect = innerWidth / innerHeight; G.cam.obj.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();

  /** 게임 시작. cont = true 면 저장된 곳에서 이어 한다. */
  const start = cont => {
    if (cont && S.load()) { const p = S.pos || [W.respawn.x, W.respawn.z, 0]; P.place(p[0], p[1], p[2]); }
    else { S.wipe(); S.reset(); P.place(W.spawn.x, W.spawn.z, Math.PI); }
    S.started = true; E.sync(); U.refresh();
    if (!S.quests.wake) U.memory(['……차가운 풀 냄새.', '누군가 부르는 소리가 들린다.'], () => { S.checkAuto(); S.save(); });
  };
  E.sync(); P.place(W.spawn.x, W.spawn.z, Math.PI);
  U.showTitle(S.hasSave(), start);

  setInterval(() => { if (S.started && !U.busy && P.state !== 'ko') S.save(); }, 15000);
  addEventListener('pagehide', () => S.save());

  let last = performance.now(), time = 0;
  const frame = now => {
    const dt = Math.min(.05, (now - last) / 1000); last = now; time += dt;
    I.poll();
    P.update(dt, time);
    E.update(dt, time);
    W.update(dt, time, P.x, P.z);
    if (U.titleOpen) {   // 제목 화면: 마을 위를 천천히 돈다
      const a = time * .08, v = W.village; G.cam.obj.position.set(v.x + Math.sin(a) * 46, 24, v.z - 14 + Math.cos(a) * 46); G.cam.obj.lookAt(v.x, 3, v.z - 12);
      P.m.root.visible = false;
    }
    I.endFrame();
    renderer.render(scene, G.cam.obj);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /* 개발·시험용 손잡이 (콘솔에서 G.debug.*) */
  G.debug = {
    scene, renderer, give: (id, n = 10) => S.add(id, n), tp: (x, z) => P.place(x, z),
    /** 화면을 그리지 않고 게임만 n 프레임 진행 (자동 시험용) */
    step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { time += dt; I.poll(); P.update(dt, time); E.update(dt, time); W.update(dt, time, P.x, P.z); I.endFrame(); } },
  };
})();
