/* world.js — 지형, 하늘과 빛, 마을과 숲 배치, 충돌, 기억의 돌이 깨어날 때의 변화.
 * 지금은 1지역(첫돌마을 + 들머리 숲)만 있다. 좌표는 x = 동쪽, z = 남쪽(북쪽이 -z).
 * 지역을 늘릴 때는 hgt() 의 지형식과 build() 의 배치를 지역 단위로 나누는 것부터 시작하면 된다. */
'use strict';
(() => {
  const T = THREE, P = G.PAL, M = G.models, geo = G.geo;
  const W = G.world = {};

  /* ---------- 주요 지점 ---------- */
  const V = W.village = { x: 0, z: 34, r: 24 };
  const S = W.stonePos = { x: -6, z: -46 };
  W.spawn = { x: 8, z: 6 };          // 처음 눈을 뜨는 곳
  W.respawn = { x: -10.5, z: 41 };   // 쓰러졌을 때 돌아오는 오두막 앞
  W.points = { board: { x: 5.5, z: 27 }, hut: { x: -11.2, z: 41.6 } };
  const riverX = z => 40 + 6 * Math.sin(z * .06);
  const flats = [{ x: V.x, z: V.z, r: V.r, y: 1 }, { x: S.x, z: S.z, r: 11, y: 1.8 }, { x: W.spawn.x, z: W.spawn.z, r: 6, y: 1.2 }];
  const paths = [
    [[V.x, V.z], [3, 16], [8, 6], [3, -14], [-5, -32], [S.x, S.z + 4]],
    [[S.x, S.z - 4], [-5, -66], [-3, -92]],
    [[V.x, V.z], [22, 35], [34, 35]],
    [[V.x, V.z], [-10, 40]],
  ];
  const pathDist = (x, z) => {
    let best = 1e9;
    for (const p of paths) for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], vx = p[i + 1][0] - ax, vz = p[i + 1][1] - az;
      const t = G.clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
    }
    return best;
  };
  const ell = (x, z) => ((x + 2) / 66) ** 2 + ((z + 12) / 80) ** 2;   // 1 근처가 골짜기 가장자리

  /** 지형 높이. 캐릭터와 모든 소품이 이 값 위에 선다. */
  const hgt = W.hgt = (x, z) => {
    const m = Math.pow(G.ss(.8, 1.9, ell(x, z)), 1.2) * 62;
    const n = 9 * Math.sin(x * .08 + z * .05) * Math.sin(z * .07) + 5 * Math.sin(x * .21) * Math.sin(z * .17 + 2);
    let y = 1 + .45 * Math.sin(x * .13) * Math.sin(z * .11) + .3 * Math.sin(x * .31 + 1) * Math.sin(z * .27) + m + n * Math.min(1, m / 25);
    for (const f of flats) { const t = 1 - G.ss(f.r * .6, f.r, Math.hypot(x - f.x, z - f.z)); y = y * (1 - t) + f.y * t; }
    y -= 2.6 * (1 - G.ss(1.5, 6, Math.abs(x - riverX(z))));
    return y;
  };
  /** 걸어갈 수 있는 곳인가: 물속·가파른 산·아직 열리지 않은 북쪽 길은 막힌다. */
  W.northLimit = () => (G.sys && G.sys.flags.stoneForest ? -86 : -62);
  W.walkable = (x, z) => { const y = hgt(x, z); return y > -.25 && y < 6.5 && z > W.northLimit() && z < 96; };

  /* ---------- 충돌 (원) ---------- */
  const colliders = W.colliders = [];
  const solid = (x, z, r) => { const c = { x, z, r }; colliders.push(c); return c; };
  /** 반지름 r 인 대상을 장애물 밖으로 밀어낸 좌표를 돌려준다. */
  W.resolve = (x, z, r) => {
    for (const c of colliders) {
      if (c.off) continue;
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), min = r + c.r;
      if (d < min && d > 1e-4) { x = c.x + dx / d * min; z = c.z + dz / d * min; }
    }
    return [x, z];
  };

  /* ---------- 인스턴싱 도우미 ---------- */
  const dummy = new T.Object3D();
  const inst = (g, max, mat) => { /* max 를 넘겨 넣으면 화면이 깨지니 넉넉히 잡을 것 */ const m = new T.InstancedMesh(g, mat || M.vcMat, max); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; W.scene.add(m); return m; };
  const instSet = (m, i, x, y, z, ry, s) => { dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.instanceMatrix.needsUpdate = true; if (i >= m.count) m.count = i + 1; };
  const instAdd = (m, x, y, z, ry, s) => { const i = m.count; instSet(m, i, x, y, z, ry, s); return i; };
  const place = (obj, x, z, ry = 0, dy = 0) => { obj.position.set(x, hgt(x, z) + dy, z); obj.rotation.y = ry; W.scene.add(obj); return obj; };

  W.build = scene => {
    W.scene = scene;
    const rng = G.makeRng(20241);
    const rr = (a, b) => a + (b - a) * rng();

    /* ----- 빛과 하늘 ----- */
    W.hemi = new T.HemisphereLight(0x9fc3d6, 0x3f5a48, 1.0); scene.add(W.hemi);
    W.sun = new T.DirectionalLight(0xffd3a0, 1.7); W.sun.castShadow = true; scene.add(W.sun, W.sun.target);
    const coarse = matchMedia('(pointer: coarse)').matches;
    W.shadowRange = coarse ? 30 : 46; W.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    const sc = W.sun.shadow.camera; sc.left = sc.bottom = -W.shadowRange; sc.right = sc.top = W.shadowRange; sc.near = 1; sc.far = 220; sc.updateProjectionMatrix();
    W.sun.shadow.bias = -.0008; W.sun.shadow.normalBias = .06;
    scene.fog = new T.Fog(P.fogAsleep, 16, 95);
    const sg = new T.SphereGeometry(500, 20, 12), cols = [], top = new T.Color(P.skyTop), mid = new T.Color(P.skyMid), low = new T.Color(P.skyLow), c = new T.Color();
    for (let i = 0; i < sg.attributes.position.count; i++) { const t = sg.attributes.position.getY(i) / 500; if (t < .22) c.copy(low).lerp(mid, G.ss(-.02, .22, t)); else c.copy(mid).lerp(top, G.ss(.22, .7, t)); cols.push(c.r, c.g, c.b); }
    sg.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    W.sky = new T.Mesh(sg, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false })); W.sky.renderOrder = -1; scene.add(W.sky);
    const cloudMat = new T.MeshBasicMaterial({ color: 0x33475a, fog: false });
    for (let i = 0; i < 14; i++) { const a = rr(0, 6.28), d = rr(200, 380), s = rr(1, 2.2); for (let k = 0; k < 4; k++) { const cl = new T.Mesh(geo.ico(rr(9, 16) * s, 1), cloudMat); cl.position.set(Math.cos(a) * d + rr(-22, 22) * s, rr(110, 170), Math.sin(a) * d + rr(-10, 10) * s); cl.scale.y = .35; scene.add(cl); } }

    /* ----- 지형 ----- */
    let tg = new T.PlaneGeometry(340, 340, 136, 136); tg.rotateX(-Math.PI / 2); tg.translate(-2, 0, -12);
    const tp = tg.attributes.position; for (let i = 0; i < tp.count; i++) tp.setY(i, hgt(tp.getX(i), tp.getZ(i)));
    tg = tg.toNonIndexed(); tg.computeVertexNormals();
    const pos = tg.attributes.position, nor = tg.attributes.normal, tc = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const slope = 1 - nor.getY(i), j = rng();
      if (y < -.2) c.set(P.sand);
      else if (pathDist(x, z) < 1.7 && y < 8) c.set(P.path).offsetHSL(0, 0, (j - .5) * .04);
      else if (y > 52 + j * 8) c.set(P.snow);
      else if (slope > .4 || y > 40) c.set(j > .5 ? P.rock : P.rockDark);
      else if (y > 9 || (z < 14 && Math.hypot(x - V.x, z - V.z) > V.r)) c.set(P.forestFloor).offsetHSL(0, 0, (j - .5) * .05);
      else c.set(j > .5 ? P.grass : P.grassDark).offsetHSL(0, 0, (j - .5) * .04);
      for (let k = 0; k < 3; k++) { tc[(i + k) * 3] = c.r; tc[(i + k) * 3 + 1] = c.g; tc[(i + k) * 3 + 2] = c.b; }
    }
    tg.setAttribute('color', new T.BufferAttribute(tc, 3));
    const terrain = new T.Mesh(tg, M.vcMat); terrain.receiveShadow = true; scene.add(terrain);
    const water = new T.Mesh(new T.PlaneGeometry(340, 340), new T.MeshLambertMaterial({ color: P.water, transparent: true, opacity: .86 })); water.rotation.x = -Math.PI / 2; water.position.set(-2, -.5, -12); scene.add(water);

    /* ----- 첫돌마을 ----- */
    const H = (x, z, ry, o, rad) => { place(M.house(o), x, z, ry); const w = (o.w || 5), n = w > 4.6 ? 2 : 1; for (let i = 0; i < n; i++) { const off = n === 1 ? 0 : (i - .5) * w * .5; solid(x + Math.cos(ry) * off, z - Math.sin(ry) * off, rad || 2.5); } };
    H(-2, 44.5, Math.PI, { style: 'hip', roof: P.roofBlue, w: 6, d: 4.8, wall: 0xe9dfc6 });          // 촌장 집
    H(-14.5, 29.5, Math.PI / 2, { roof: P.roofRed, w: 5.2 });                                          // 도담의 공방
    H(-14.5, 41.5, Math.PI / 2, { roof: P.roofGreen, w: 4, d: 3.6, h: 2.3 }, 2.3);                     // 주인공 오두막
    H(13, 44, -2.4, { style: 'hip', roof: P.roofGreen, w: 4.6, d: 4 });
    H(-5, 17.5, 0, { roof: P.roofYellow, w: 4.4, d: 3.6 });
    place(M.logPile(), -10.5, 27, .3); solid(-10.5, 27, 1);
    const mill = place(M.windmill(), 17, 21, -.7); W.blades = mill.userData.blades; solid(17, 21, 2.6);
    place(M.stall(), 12.2, 30, -2.6); solid(12.2, 30, 1.7);
    place(M.tent(), 10.5, 41.5); solid(10.5, 41.5, 1.7); place(M.tent(0xd9c79a), 15, 37); solid(15, 37, 1.7);
    place(M.cairn(6, 1.6), V.x, V.z); solid(V.x, V.z, 1.1);
    W.fire = place(M.campfire(), 3.5, 37); solid(3.5, 37, .8);
    place(M.board(), W.points.board.x, W.points.board.z - .8, 0); solid(W.points.board.x, W.points.board.z - .8, .9);
    place(M.post(), .2, 16.5, .15); place(M.post(), 5.6, 15.8, -.15); solid(.2, 16.5, .4); solid(5.6, 15.8, .4);
    place(M.fence(9), -9.5, 23.5, 0); place(M.fence(8), 20, 28.5, Math.PI / 2); place(M.fence(7), 6, 48, .1);
    const br = M.bridge(); br.position.set(riverX(35), .75, 35); scene.add(br);
    place(M.cairn(4), W.spawn.x + 3.2, W.spawn.z - 2); solid(W.spawn.x + 3.2, W.spawn.z - 2, .7);
    place(M.cairn(5, 1.2), -13, -30); solid(-13, -30, .8); place(M.cairn(3), 6, -22); solid(6, -22, .6);

    /* ----- 기억의 돌 ----- */
    W.stone = place(M.memoryStone(), S.x, S.z); solid(S.x, S.z, 1.5);
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28; solid(S.x + Math.cos(a) * 3.6, S.z + Math.sin(a) * 3.6, .4); }

    /* ----- 나무 ----- */
    const kinds = [M.pineGeo(P.pine[0]), M.pineGeo(P.pine[1]), M.leafyGeo(P.leaf[0]), M.leafyGeo(P.leaf[1]), M.leafyGeo(P.blossom)].map(g => inst(g, 1200));
    const stumps = inst(M.stumpGeo(), 700), bare = inst(M.bareGeo(), 700);
    const trees = W.trees = [];   // 벨 수 있는 나무만 (걸어갈 수 있는 곳에 있는 것)
    let tries = 0, n = 0;
    while (n < 1150 && tries++ < 14000) {
      const x = rr(-150, 150), z = rr(-160, 130), y = hgt(x, z), e = ell(x, z);
      if (y < .3 || y > 38) continue;
      if (Math.hypot(x - V.x, z - V.z) < V.r + 1 || pathDist(x, z) < 3.2 || Math.hypot(x - S.x, z - S.z) < 8 || Math.hypot(x - W.spawn.x, z - W.spawn.z) < 4.5) continue;
      const dens = e > 1 ? .8 : (z < 14 ? .4 : .12);
      if (rng() > dens) continue;
      const k = y > 8 || rng() < .5 ? (rng() < .5 ? 0 : 1) : (rng() < .1 ? 4 : (rng() < .5 ? 2 : 3));
      const s = rr(.9, 1.6), ry = rr(0, 6.28), idx = instAdd(kinds[k], x, y, z, ry, s); n++;
      if (e < 1.02 && y < 6.5) {
        const tr = { id: trees.length, x, z, y, ry, s, mesh: kinds[k], idx, alive: true, hp: 0, timer: 0, col: solid(x, z, .5) };
        tr.stump = instAdd(stumps, x, y, z, ry, 0); instAdd(bare, x, y, z, ry, 0); tr.bare = false; trees.push(tr);
      }
    }
    const drawTree = tr => { const full = tr.alive && !tr.bare; instSet(tr.mesh, tr.idx, tr.x, tr.y, tr.z, tr.ry, full ? tr.s : 0); instSet(bare, tr.stump, tr.x, tr.y, tr.z, tr.ry, tr.alive && tr.bare ? tr.s : 0); instSet(stumps, tr.stump, tr.x, tr.y, tr.z, tr.ry, tr.alive ? 0 : tr.s); };
    W.setTree = (tr, alive) => { tr.alive = alive; tr.hp = 0; drawTree(tr); };
    /** 카메라(cx, cz)와 주인공(px, pz) 사이를 가리는 나무는 잎을 걷고 줄기만 보여 준다 */
    W.clearView = (cx, cz, px, pz) => {
      const vx = px - cx, vz = pz - cz, len2 = vx * vx + vz * vz || 1;
      for (const tr of trees) {
        if (!tr.alive) continue;
        const t = ((tr.x - cx) * vx + (tr.z - cz) * vz) / len2;
        const hide = (t > -.15 && t < .9 && Math.hypot(tr.x - cx - vx * t, tr.z - cz - vz * t) < 1.5 * tr.s + .5) || Math.hypot(tr.x - cx, tr.z - cz) < 2 * tr.s + 1.2;
        if (hide !== tr.bare) { tr.bare = hide; drawTree(tr); }
      }
    };
    /** 나무가 맞을 때 살짝 흔들리는 연출 */
    W.shakeTree = (tr, k) => { if (tr.bare) return; dummy.position.set(tr.x, tr.y, tr.z); dummy.rotation.set(Math.sin(k * 40) * .05 * k, tr.ry, Math.cos(k * 33) * .05 * k); dummy.scale.setScalar(tr.s); dummy.updateMatrix(); tr.mesh.setMatrixAt(tr.idx, dummy.matrix); tr.mesh.instanceMatrix.needsUpdate = true; };

    /* ----- 덤불 · 약초 · 바위 · 풀꽃 ----- */
    const freeSpot = (minTree) => { for (let t = 0; t < 60; t++) { const x = rr(-46, 30), z = rr(-60, 12); if (!W.walkable(x, z) || hgt(x, z) > 5 || pathDist(x, z) < 2.6 || Math.hypot(x - S.x, z - S.z) < 6) continue; if (trees.every(tr => Math.hypot(tr.x - x, tr.z - z) > minTree)) return [x, z]; } return null; };
    const bushM = inst(M.bushGeo(), 40), berryM = inst(M.berryGeo(), 40), herbM = inst(M.herbGeo(), 30);
    W.bushes = []; W.herbs = [];
    for (let i = 0; i < 32; i++) { const p = freeSpot(1.8); if (!p) continue; const y = hgt(p[0], p[1]), ry = rr(0, 6.28); const b = { id: i, kind: 'bush', x: p[0], z: p[1], y, ry, ripe: true, timer: 0, idx: instAdd(bushM, p[0], y, p[1], ry, 1) }; instAdd(berryM, p[0], y, p[1], ry, 1); solid(p[0], p[1], .55); W.bushes.push(b); }
    for (let i = 0; i < 22; i++) { const p = freeSpot(1.2); if (!p) continue; const y = hgt(p[0], p[1]); W.herbs.push({ id: i, kind: 'herb', x: p[0], z: p[1], y, ry: 0, ripe: true, timer: 0, idx: instAdd(herbM, p[0], y, p[1], rr(0, 6), 1.3) }); }
    W.setNode = (nd, ripe) => { nd.ripe = ripe; nd.timer = 0; instSet(nd.kind === 'bush' ? berryM : herbM, nd.idx, nd.x, nd.y, nd.z, nd.ry, ripe ? (nd.kind === 'bush' ? 1 : 1.3) : 0); };
    const rocks = inst(M.rockGeo(), 90);
    for (let i = 0; i < 80; i++) { const x = rr(-70, 60), z = rr(-95, 90), y = hgt(x, z); if (y < .2 || y > 20 || pathDist(x, z) < 2.5 || Math.hypot(x - V.x, z - V.z) < V.r - 6 || Math.hypot(x - S.x, z - S.z) < 6) continue; const s = rr(.35, 1.3); instAdd(rocks, x, y, z, rr(0, 6), s); if (s > .7) solid(x, z, s * .8); }
    const grass = inst(M.grassGeo(), 900); grass.castShadow = false;
    for (let i = 0; i < 880; i++) { const x = rr(-60, 46), z = rr(-84, 70), y = hgt(x, z); if (y < .2 || y > 7 || pathDist(x, z) < 1.8) continue; instAdd(grass, x, y, z, rr(0, 6), rr(.8, 1.5)); }
    const fl = [0xe9e4d2, 0xd9b84a, 0xc98aa8, 0x9f8fd0].map(col => { const m = inst(M.flowerGeo(col), 60); m.castShadow = false; return m; });
    for (let i = 0; i < 200; i++) { const a = rr(0, 6.28), d = Math.sqrt(rng()) * (V.r + 4), x = V.x + Math.cos(a) * d, z = V.z + Math.sin(a) * d; if (pathDist(x, z) > 1.6 && fl[i % 4].count < 60) instAdd(fl[i % 4], x, hgt(x, z), z, 0, rr(.8, 1.3)); }
    /* 돌이 깨어나면 피어나는 꽃 (처음엔 숨김) */
    W.stoneFlowers = [0xdffaff, 0x9fe8e0, 0xe9e4d2].map(col => { const m = inst(M.flowerGeo(col), 80); m.castShadow = false; m.visible = false; return m; });
    for (let i = 0; i < 230; i++) { const a = rr(0, 6.28), d = 2.2 + Math.sqrt(rng()) * 15, x = S.x + Math.cos(a) * d, z = S.z + Math.sin(a) * d; const m = W.stoneFlowers[i % 3]; if (m.count < 80 && hgt(x, z) < 6) instAdd(m, x, hgt(x, z), z, 0, rr(.9, 1.6)); }

    /* ----- 안개 (돌이 잠든 동안 숲을 덮는다) ----- */
    W.mistMat = new T.MeshLambertMaterial({ color: 0xcfd3e2, transparent: true, opacity: .26, depthWrite: false });
    W.mist = inst(geo.ico(1, 1), 90, W.mistMat); W.mist.castShadow = false; W.mist.receiveShadow = false; W.mist.renderOrder = 2;
    for (let i = 0; i < 60; i++) { const x = rr(-46, 28), z = rr(-74, 2), y = hgt(x, z); if (y > 7) continue; dummy.position.set(x, y + rr(.5, 1.8), z); dummy.rotation.set(0, rr(0, 6), 0); dummy.scale.set(rr(2.5, 5), rr(.7, 1.3), rr(2.5, 5)); dummy.updateMatrix(); W.mist.setMatrixAt(W.mist.count++, dummy.matrix); }
    for (let i = 0; i < 26; i++) { const x = -5 + rr(-16, 16), z = rr(-70, -63), y = hgt(x, z); dummy.position.set(x, y + rr(.5, 5), z); dummy.rotation.set(0, rr(0, 6), 0); dummy.scale.set(rr(3, 5), rr(1.5, 3), rr(2, 3)); dummy.updateMatrix(); W.mist.setMatrixAt(W.mist.count++, dummy.matrix); }

    /* ----- 떠다니는 빛 ----- */
    const fp = new Float32Array(160 * 3); W.motes = [];
    for (let i = 0; i < 160; i++) { const x = rr(-55, 40), z = rr(-85, 60); W.motes.push({ x, y: hgt(x, z) + rr(.6, 4), z, ph: rr(0, 6.28), sp: rr(.3, .9) }); }
    const fgm = new T.BufferGeometry(); fgm.setAttribute('position', new T.BufferAttribute(fp, 3));
    W.moteMesh = new T.Points(fgm, new T.PointsMaterial({ color: P.glow, size: .16, transparent: true, opacity: .85, depthWrite: false })); W.moteMesh.frustumCulled = false; scene.add(W.moteMesh);
  };

  /* ---------- 분위기: k = 0 잠든 숲, 1 깨어난 숲 ---------- */
  const fa = new T.Color(P.fogAsleep), fb = new T.Color(P.fogAwake);
  W.mood = 0;
  W.setMood = k => {
    W.mood = k;
    W.scene.fog.color.copy(fa).lerp(fb, k); W.scene.fog.near = G.lerp(16, 30, k); W.scene.fog.far = G.lerp(95, 170, k);
    W.hemi.intensity = G.lerp(1.0, 1.25, k); W.sun.intensity = G.lerp(1.7, 2.3, k);
    W.mistMat.opacity = .26 * (1 - k); W.mist.visible = k < .98;
    W.stone.userData.setAwake(k);
    W.stoneFlowers.forEach(m => m.visible = k > .5);
  };

  let moodFrom = 0, moodTo = 0, moodT = 1;
  /** 1지역의 돌을 깨운다. instant = 저장 불러오기 등 연출 없이 바로 */
  W.awaken = instant => { if (instant) { W.setMood(1); moodT = 1; return; } moodFrom = W.mood; moodTo = 1; moodT = 0; };

  W.update = (dt, t, px, pz) => {
    if (moodT < 1) { moodT = Math.min(1, moodT + dt / 4); W.setMood(G.lerp(moodFrom, moodTo, G.ss(0, 1, moodT))); }
    W.blades.rotation.z += dt * .5;
    W.fire.userData.flame.scale.y = 1 + Math.sin(t * 11) * .18; W.fire.userData.light.intensity = 10 + Math.sin(t * 13) * 2;
    W.stone.userData.gem.rotation.y += dt * (.3 + W.mood); W.stone.userData.gem.position.y = 7.1 + Math.sin(t * 1.5) * .12 * W.mood;
    const a = W.moteMesh.geometry.attributes.position;
    for (let i = 0; i < W.motes.length; i++) { const m = W.motes[i]; a.setXYZ(i, m.x + Math.sin(t * m.sp + m.ph) * .8, m.y + Math.sin(t * m.sp * 1.7 + m.ph) * .5, m.z + Math.cos(t * m.sp + m.ph) * .8); }
    a.needsUpdate = true;
    /* 그림자 카메라와 하늘은 플레이어를 따라간다 */
    W.sun.target.position.set(px, 0, pz); W.sun.position.set(px - 45, 62, pz - 55); W.sky.position.set(px, 0, pz);
    /* 자원 다시 자라기 */
    for (const tr of W.trees) if (!tr.alive && (tr.timer += dt) > 70) W.setTree(tr, true);
    for (const nd of W.bushes) if (!nd.ripe && (nd.timer += dt) > 55) W.setNode(nd, true);
    for (const nd of W.herbs) if (!nd.ripe && (nd.timer += dt) > 65) W.setNode(nd, true);
  };
})();
