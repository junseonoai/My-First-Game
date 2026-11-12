/* models.js — 코드로 빚는 로우폴리 모델들.
 * 외부 모델 파일 없이 기본 도형을 합쳐서 만든다. Builder 로 여러 도형을 정점 색을 가진
 * 하나의 지오메트리로 합치므로, 모델 하나가 드로우콜 하나가 된다. */
'use strict';
(() => {
  const T = THREE, P = G.PAL;
  const geo = G.geo = {
    box: (w, h, d) => new T.BoxGeometry(w, h, d),
    cyl: (rt, rb, h, n = 6) => new T.CylinderGeometry(rt, rb, h, n),
    cone: (r, h, n = 6) => new T.ConeGeometry(r, h, n),
    ico: (r, d = 0) => new T.IcosahedronGeometry(r, d),
    dod: r => new T.DodecahedronGeometry(r),
    oct: r => new T.OctahedronGeometry(r),
    sph: (r, w = 8, h = 6, th = Math.PI) => new T.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, th),
    tor: (r, t, a = 4, b = 8, arc = Math.PI * 2) => new T.TorusGeometry(r, t, a, b, arc),
  };
  const M = G.models = {};
  M.vcMat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  M.glowMat = new T.MeshBasicMaterial({ vertexColors: true });
  M.blurMat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: .7 });

  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _p = new T.Vector3(), _s = new T.Vector3(), _c = new T.Color();
  /** 도형을 색과 함께 쌓아 하나의 지오메트리로 합친다. o = { rx, ry, rz, sx, sy, sz, s } */
  class Builder {
    constructor() { this.pos = []; this.col = []; }
    add(g, color, x = 0, y = 0, z = 0, o = {}) {
      const ng = g.index ? g.toNonIndexed() : g;
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e);
      const s = o.s || 1; _s.set((o.sx || 1) * s, (o.sy || 1) * s, (o.sz || 1) * s);
      _m.compose(_p.set(x, y, z), _q, _s);
      const a = ng.attributes.position; _c.set(color);
      for (let i = 0; i < a.count; i++) {
        _p.fromBufferAttribute(a, i).applyMatrix4(_m);
        this.pos.push(_p.x, _p.y, _p.z); this.col.push(_c.r, _c.g, _c.b);
      }
      return this;
    }
    geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
      g.computeVertexNormals();
      return g;
    }
    mesh(mat = M.vcMat, shadow = true) { const m = new T.Mesh(this.geometry(), mat); m.castShadow = shadow && mat !== M.glowMat; m.receiveShadow = shadow && mat !== M.glowMat; return m; }
  }
  M.Builder = Builder;
  const B = () => new Builder();

  /* ================= 주인공 =================
   * 은빛에서 청록으로 물드는 머리, 끊어진 원이 수놓인 남색 망토, 돌 등불 지팡이.
   * 반환: { root, rig, head, armL, armR, staff, legL, legR, light, core } — player.js 가 관절을 움직인다. */
  M.hero = () => {
    const root = new T.Group(), rig = new T.Group(); rig.position.y = .9; root.add(rig);
    const Y = -.9; // rig 기준으로 내려서 붙인다 (rig 가 구르기 회전축)
    const part = (b, x, y, z) => { const g = new T.Group(); g.position.set(x, y + Y, z); g.add(b.mesh()); rig.add(g); return g; };

    const leg = () => B().add(geo.box(.19, .6, .2), P.skin, 0, -.3, 0)
      .add(geo.box(.21, .07, .22), P.wrap, 0, -.4, 0).add(geo.box(.21, .07, .22), P.wrap, 0, -.52, 0)
      .add(geo.box(.23, .08, .38), P.woodDark, 0, -.66, .05);
    const legL = part(leg(), -.15, .72, 0), legR = part(leg(), .15, .72, 0);

    const body = B()
      .add(geo.cyl(.28, .5, .95, 7), P.tunic, 0, 1.08, 0)
      .add(geo.cyl(.43, .45, .09, 7), P.woodDark, 0, .98, 0)
      .add(geo.box(.22, .2, .16), 0x7a6247, .37, .86, .14).add(geo.dod(.05), P.stone, .33, .9, .23).add(geo.dod(.05), P.stone, .42, .84, .23)
      .add(geo.cyl(.3, .66, .72, 7), P.cape, 0, 1.32, 0, { rz: .06 })
      .add(geo.box(.74, .5, .06), P.cape, -.08, .94, -.52, { rx: .28, rz: .1 })
      .add(geo.tor(.27, .1, 5, 7), P.cape, 0, 1.64, 0, { rx: Math.PI / 2 });
    part(body, 0, 0, 0);
    const emblem = B().add(geo.tor(.2, .032, 4, 12, 4.9), P.capeTrim, 0, 1.28, -.5, { rx: .46, rz: 1.9 }).mesh(M.glowMat);
    emblem.position.y = Y; rig.add(emblem);

    const hb = B()
      .add(geo.sph(.4), P.skin, 0, .36, 0, { sy: .95, sz: .95 })
      .add(geo.box(.08, .13, .04), 0x26303a, -.15, .34, .37).add(geo.box(.08, .13, .04), 0x26303a, .15, .34, .37)
      .add(geo.box(.1, .04, .04), 0xdf9a88, -.27, .23, .33).add(geo.box(.1, .04, .04), 0xdf9a88, .27, .23, .33)
      .add(geo.sph(.46, 8, 5, 1.5), P.hairSilver, 0, .4, -.03, { rx: -.45 })
      .add(geo.box(.66, .14, .1), P.hairSilver, 0, .62, .35, { rx: -.3 })
      .add(geo.box(.12, .36, .28), P.hairSilver, -.42, .34, .08).add(geo.box(.12, .36, .28), P.hairSilver, .42, .34, .08)
      .add(geo.box(.12, .26, .26), P.hairTeal, -.42, .05, .06).add(geo.box(.12, .26, .26), P.hairTeal, .42, .05, .06)
      .add(geo.box(.74, .36, .2), P.hairSilver, 0, .36, -.34)
      .add(geo.box(.78, .34, .22), 0x7fc5c0, 0, .04, -.37)
      .add(geo.box(.72, .24, .2), P.hairTeal, 0, -.22, -.38);
    const head = part(hb, 0, 1.66, 0);

    const armL = part(B().add(geo.box(.2, .3, .22), P.tunic, 0, -.14, 0).add(geo.box(.18, .36, .2), P.wrap, 0, -.46, 0).add(geo.box(.16, .14, .18), P.skin, 0, -.72, 0), -.42, 1.5, 0);
    const armR = part(B().add(geo.box(.2, .3, .22), P.tunic, 0, -.14, 0).add(geo.box(.16, .4, .18), P.skin, 0, -.48, 0).add(geo.box(.16, .14, .18), P.skin, 0, -.72, 0), .42, 1.5, 0);
    /* 지팡이는 손을 축으로 따로 돈다 (휘두르기 연출용). 위쪽 끝에 돌 등불이 달려 있다. */
    const staff = new T.Group(); staff.position.set(0, -.72, .14); armR.add(staff);
    const sb = B().add(geo.cyl(.04, .05, 2.5, 5), P.wood, 0, .45, 0)
      .add(geo.box(.045, .045, .36), P.wood, 0, 1.68, .16).add(geo.box(.02, .1, .02), P.stoneDark, 0, 1.62, .3)
      .add(geo.cone(.17, .12, 4), P.stoneDark, 0, 1.6, .3, { ry: Math.PI / 4 }).add(geo.box(.22, .04, .22), P.stoneDark, 0, 1.32, .3);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sb.add(geo.box(.03, .24, .03), P.stoneDark, sx * .09, 1.44, .3 + sz * .09);
    staff.add(sb.mesh());
    const core = new T.Mesh(geo.oct(.085), new T.MeshBasicMaterial({ color: P.glow })); core.position.set(0, 1.44, .3); staff.add(core);
    const light = new T.PointLight(P.glow, 4, 12, 1.6); light.position.set(0, 1.44, .5); staff.add(light);
    return { root, rig, head, armL, armR, staff, legL, legR, light, core };
  };

  /* ================= 주민 ================= */
  M.npc = (o = {}) => {
    const { skin = P.skin, hair = 0x4a3326, tunic = P.tunic, pants = 0x4b3f36, scarf = null, hat = null, bun = false, apron = null, scale = 1 } = o;
    const b = B();
    for (const s of [-1, 1]) b.add(geo.box(.24, .55, .26), pants, s * .16, .55, 0).add(geo.box(.28, .28, .4), P.woodDark, s * .16, .14, .05);
    b.add(geo.cyl(.3, .44, .85, 6), tunic, 0, 1.2, 0).add(geo.cyl(.41, .41, .1, 6), P.woodDark, 0, 1.0, 0);
    if (apron) b.add(geo.box(.5, .6, .05), apron, 0, 1.0, .37);
    for (const s of [-1, 1]) b.add(geo.box(.2, .62, .22), tunic, s * .46, 1.2, 0, { rz: s * .2 }).add(geo.box(.18, .17, .2), skin, s * .54, .84, 0);
    b.add(geo.sph(.46), skin, 0, 2.05, 0, { sy: .95, sz: .95 })
      .add(geo.box(.09, .14, .04), 0x26303a, -.17, 2.03, .43).add(geo.box(.09, .14, .04), 0x26303a, .17, 2.03, .43)
      .add(geo.box(.1, .05, .04), 0xdf9a88, -.3, 1.91, .38).add(geo.box(.1, .05, .04), 0xdf9a88, .3, 1.91, .38)
      .add(geo.sph(.5, 8, 5, 1.5), hair, 0, 2.09, -.04, { rx: -.5 })
      .add(geo.box(.7, .14, .1), hair, 0, 2.38, .4, { rx: -.3 })
      .add(geo.box(.14, .34, .3), hair, -.44, 2.13, .12).add(geo.box(.14, .34, .3), hair, .44, 2.13, .12);
    if (bun) b.add(geo.ico(.2), hair, 0, 2.6, -.1);
    if (hat === 'straw') b.add(geo.cone(.85, .42, 8), 0xcdb878, 0, 2.63, 0);
    if (hat === 'cap') b.add(geo.cyl(.4, .5, .3, 7), P.roofBlue, 0, 2.55, 0).add(geo.box(.5, .06, .3), P.roofBlue, 0, 2.43, .5);
    if (scarf) b.add(geo.tor(.33, .12, 5, 7), scarf, 0, 1.66, 0, { rx: Math.PI / 2 });
    const g = new T.Group(); const m = b.mesh(); g.add(m); g.scale.setScalar(scale); g.userData.body = m;
    return g;
  };

  /* ================= 골짜기의 생물 =================
   * clear = 제 모습, blur = 흐려진 모습. 같은 그룹 안에 둘 다 두고 보이기를 바꾼다. */
  M.creature = () => {
    const shape = (body, belly, leaf) => {
      const b = B().add(geo.ico(.62, 1), body, 0, .6, 0, { sy: .85, sz: 1.1 }).add(geo.ico(.4, 1), belly, 0, .5, .34, { sy: .8, sz: .7 })
        .add(geo.ico(.3), body, 0, .55, -.75, { sx: .8, sy: .8, sz: 1.4 });
      for (const s of [-1, 1]) b.add(geo.cone(.16, .42, 4), body, s * .3, 1.2, .1, { rz: -s * .3 }).add(geo.box(.16, .14, .22), body, s * .28, .1, .18);
      if (leaf) b.add(geo.cone(.16, .42, 4), 0x62b04f, 0, 1.32, -.05, { rz: .5 }).add(geo.box(.1, .13, .04), 0x26303a, -.2, .78, .6).add(geo.box(.1, .13, .04), 0x26303a, .2, .78, .6);
      return b;
    };
    const g = new T.Group();
    const clear = shape(0xe0a455, 0xf3e3c2, true).mesh(); g.add(clear);
    const bb = shape(0x9d9bbb, 0xbdbbd6, false);
    const rng = G.makeRng(11);
    for (let i = 0; i < 6; i++) bb.add(geo.ico(.18 + rng() * .2), 0xcfcde2, rng() * 2 - 1, .2 + rng() * 1.2, rng() * 2 - 1.1);
    const blur = new T.Group(); blur.add(bb.mesh(M.blurMat, false));
    blur.add(B().add(geo.box(.1, .06, .04), 0xfff0a0, -.2, .78, .6).add(geo.box(.1, .06, .04), 0xfff0a0, .2, .78, .6).mesh(M.glowMat));
    g.add(blur);
    g.userData = { clear, blur };
    return g;
  };

  /* ================= 식물 (인스턴싱용 지오메트리) ================= */
  M.pineGeo = c => B().add(geo.cyl(.22, .32, 1.6, 5), P.trunk, 0, .8, 0).add(geo.cone(1.7, 2.4, 6), c, 0, 2.4, 0).add(geo.cone(1.3, 2.1, 6), c, 0, 3.7, 0).add(geo.cone(.85, 1.8, 6), c, 0, 4.9, 0).geometry();
  M.leafyGeo = c => B().add(geo.cyl(.25, .38, 2.2, 5), P.trunk, 0, 1.1, 0).add(geo.ico(1.7), c, 0, 3.3, 0, { rx: .4, ry: .8 }).add(geo.ico(1.15), c, 1.0, 2.7, .4, { rz: .6 }).add(geo.ico(1.0), c, -.9, 2.9, -.5, { rx: 1 }).geometry();
  M.bareGeo = () => B().add(geo.cyl(.16, .34, 3.4, 5), P.trunk, 0, 1.7, 0).add(geo.cyl(.05, .09, 1.1, 4), P.trunk, .35, 2.7, 0, { rz: -.9 }).add(geo.cyl(.05, .09, .9, 4), P.trunk, -.3, 3.1, .1, { rz: .8 }).geometry();
  M.stumpGeo = () => B().add(geo.cyl(.3, .38, .5, 6), P.trunk, 0, .25, 0).add(geo.cyl(.26, .26, .04, 6), 0xb89a72, 0, .51, 0).geometry();
  M.bushGeo = () => B().add(geo.ico(.75), 0x3f7f47, 0, .5, 0, { sy: .75 }).add(geo.ico(.5), 0x4a8a4c, .45, .4, .2, { sy: .7 }).geometry();
  M.berryGeo = () => { const b = B(), r = G.makeRng(5); for (let i = 0; i < 7; i++) { const a = r() * 6.28, e = .2 + r() * .9; b.add(geo.ico(.11), 0xd8475a, Math.cos(a) * .66 * Math.cos(e), .5 + .52 * Math.sin(e), Math.sin(a) * .66 * Math.cos(e)); } return b.geometry(); };
  M.herbGeo = () => B().add(geo.cone(.1, .5, 4), 0x6fae62, -.12, .25, 0, { rz: .4 }).add(geo.cone(.1, .55, 4), 0x7dbd6c, .12, .27, .05, { rz: -.4 }).add(geo.cone(.09, .5, 4), 0x6fae62, 0, .25, -.12, { rx: -.4 }).add(geo.ico(.1), 0xdff3ff, 0, .55, 0).geometry();
  M.rockGeo = () => B().add(geo.dod(1), P.rock, 0, .35, 0, { sy: .65 }).geometry();
  M.grassGeo = () => B().add(geo.cone(.09, .5, 3), 0x6aa655, 0, .25, 0).add(geo.cone(.08, .4, 3), 0x5a9650, .14, .2, .05, { rz: -.3 }).add(geo.cone(.08, .42, 3), 0x5a9650, -.12, .21, -.06, { rz: .3 }).geometry();
  M.flowerGeo = c => B().add(geo.cyl(.02, .02, .3, 3), 0x5a9650, 0, .15, 0).add(geo.ico(.11), c, 0, .34, 0).geometry();

  /* ================= 건물과 소품 ================= */
  /** 집. style 'gable' = 박공지붕 오두막, 'hip' = 넓은 처마 지붕. 문은 +z 쪽. */
  M.house = (o = {}) => {
    const { w = 5, d = 4, h = 2.6, wall = P.wall, roof = P.roofRed, style = 'gable' } = o;
    const b = B(), gl = B();
    b.add(geo.box(w + .3, .5, d + .3), P.stone, 0, .25, 0).add(geo.box(w, h, d), wall, 0, .5 + h / 2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(geo.box(.22, h, .22), P.woodDark, sx * w / 2, .5 + h / 2, sz * d / 2);
    b.add(geo.box(w + .1, .18, d + .1), P.woodDark, 0, .5 + h * .55, 0);
    if (style === 'gable') {
      const rh = d * .62, sh = new T.Shape(); sh.moveTo(-d / 2 - .5, 0); sh.lineTo(d / 2 + .5, 0); sh.lineTo(0, rh); sh.closePath();
      const rg = new T.ExtrudeGeometry(sh, { depth: w + .9, bevelEnabled: false }); rg.translate(0, 0, -(w + .9) / 2); rg.rotateY(Math.PI / 2);
      b.add(rg, roof, 0, .5 + h, 0).add(geo.box(w + 1, .16, .3), P.woodDark, 0, .5 + h + rh, 0).add(geo.box(.6, 1.5, .6), P.stone, w * .28, .5 + h + d * .42, -d * .2);
    } else {
      const r = Math.max(w, d);
      b.add(geo.cone(r * .86, h * .75, 4), roof, 0, .5 + h + h * .37, 0, { ry: Math.PI / 4, sz: d / w + .15 })
        .add(geo.cyl(r * .9, r * .98, .22, 4), roof, 0, .5 + h + .06, 0, { ry: Math.PI / 4, sz: d / w + .15 })
        .add(geo.box(.5, .4, .5), 0xc7a54a, 0, .5 + h + h * .78, 0);
    }
    b.add(geo.box(1, 1.7, .12), P.woodDark, -w * .18, 1.35, d / 2 + .04);
    b.add(geo.box(1.0, .1, .14), P.woodDark, w * .24, .5 + h * .58, d / 2 + .08).add(geo.box(.1, .9, .14), P.woodDark, w * .24, .5 + h * .58, d / 2 + .08);
    gl.add(geo.box(.9, .8, .1), P.warm, w * .24, .5 + h * .58, d / 2 + .04);
    const g = new T.Group(); g.add(b.mesh(), gl.mesh(M.glowMat)); return g;
  };
  M.windmill = () => {
    const g = new T.Group();
    g.add(B().add(geo.cyl(1.5, 2.3, 7, 8), P.wall, 0, 3.5, 0).add(geo.cone(1.9, 2, 8), P.roofBlue, 0, 8, 0).add(geo.box(.9, 1.6, .15), P.woodDark, 0, .8, 2.2).mesh());
    const hub = new T.Group(); hub.position.set(0, 6.6, 1.95); g.add(hub);
    const hb = B().add(geo.cyl(.3, .3, .8, 6), P.woodDark, 0, 0, 0, { rx: Math.PI / 2 });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a); hb.add(geo.box(.16, 5, .1), P.woodDark, -s * 2.5, c * 2.5, .3, { rz: a }).add(geo.box(1.1, 3.6, .06), P.cloth, -s * 3 + c * .6, c * 3 + s * .6, .3, { rz: a }); }
    hub.add(hb.mesh()); g.userData.blades = hub; return g;
  };
  M.cairn = (n = 5, s = 1) => { const b = B(); let y = 0; for (let i = 0; i < n; i++) { const r = s * (.62 - i * .1); b.add(geo.dod(r), i % 2 ? P.stone : P.stoneDark, 0, y + r * .45, 0, { sy: .55, ry: i * 1.3 }); y += r * .9; } return b.mesh(); };
  M.post = () => B().add(geo.cyl(.26, .3, 2.6, 6), P.wood, 0, 1.3, 0).add(geo.box(.75, .5, .6), P.woodDark, 0, 2.75, 0).add(geo.box(.95, .12, .7), P.roofRed, 0, 3.06, 0)
    .add(geo.box(.1, .1, .05), 0x1f1a17, -.16, 2.8, .31).add(geo.box(.1, .1, .05), 0x1f1a17, .16, 2.8, .31).add(geo.box(.3, .06, .05), P.cloth, 0, 2.62, .31).mesh();
  M.tent = c => B().add(geo.cone(1.9, 2.5, 5), c || P.cloth, 0, 1.25, 0).add(geo.cyl(.05, .05, .7, 4), P.woodDark, 0, 2.7, 0).add(geo.box(.5, .3, .02), P.roofRed, .25, 2.9, 0).mesh();
  M.stall = () => B().add(geo.box(3, .9, 1.3), P.wood, 0, .45, 0).add(geo.box(3.4, .1, 1.9), P.roofRed, 0, 2.5, .1, { rx: .15 })
    .add(geo.box(.12, 2.5, .12), P.woodDark, -1.5, 1.25, -.6).add(geo.box(.12, 2.5, .12), P.woodDark, 1.5, 1.25, -.6)
    .add(geo.box(.5, .4, .5), 0xc79a63, -.9, 1.1, 0).add(geo.ico(.22), 0xd8475a, .1, 1.05, .1).add(geo.ico(.2), 0x6fae62, .5, 1.05, -.1).add(geo.cyl(.2, .16, .4, 6), 0x7fc5c0, 1.0, 1.1, 0).mesh();
  M.board = () => B().add(geo.box(.14, 2.2, .14), P.woodDark, -.9, 1.1, 0).add(geo.box(.14, 2.2, .14), P.woodDark, .9, 1.1, 0).add(geo.box(2.1, 1.2, .1), P.wood, 0, 1.5, 0)
    .add(geo.box(.5, .6, .03), P.cloth, -.5, 1.55, .07, { rz: .05 }).add(geo.box(.45, .5, .03), P.cloth, .2, 1.45, .07, { rz: -.08 }).add(geo.box(.4, .4, .03), 0xe6c98a, .68, 1.7, .07).add(geo.box(2.4, .12, .5), P.roofRed, 0, 2.25, 0).mesh();
  M.campfire = () => { const g = new T.Group(); const b = B(); for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; b.add(geo.dod(.2), P.stoneDark, Math.cos(a) * .6, .1, Math.sin(a) * .6); } b.add(geo.cyl(.07, .07, .9, 4), P.woodDark, 0, .15, 0, { rz: 1.4 }).add(geo.cyl(.07, .07, .9, 4), P.woodDark, 0, .15, 0, { rz: 1.4, ry: 1.6 }); g.add(b.mesh());
    const f = new T.Mesh(geo.cone(.3, .8, 5), new T.MeshBasicMaterial({ color: 0xffa23a })); f.position.y = .55; g.add(f); g.userData.flame = f;
    const l = new T.PointLight(0xffa85a, 10, 16, 1.6); l.position.y = 1.2; g.add(l); g.userData.light = l; return g; };
  M.logPile = () => { const b = B(); for (let i = 0; i < 3; i++) b.add(geo.cyl(.22, .22, 1.8, 6), P.trunk, 0, .22, i * .46 - .46, { rz: Math.PI / 2 }); b.add(geo.cyl(.22, .22, 1.8, 6), P.trunk, 0, .6, -.23, { rz: Math.PI / 2 }).add(geo.cyl(.22, .22, 1.8, 6), P.trunk, 0, .6, .23, { rz: Math.PI / 2 }); return b.mesh(); };
  M.fence = len => { const b = B(), n = Math.max(1, Math.round(len / 1.4)); for (let i = 0; i <= n; i++) b.add(geo.box(.16, .9, .16), P.wood, -len / 2 + len * i / n, .45, 0); b.add(geo.box(len, .1, .08), P.wood, 0, .65, 0).add(geo.box(len, .1, .08), P.wood, 0, .35, 0); return b.mesh(); };
  M.bridge = () => B().add(geo.box(12, .3, 2.6), P.wood, 0, 0, 0).add(geo.box(12, .12, .12), P.woodDark, 0, .8, -1.2).add(geo.box(12, .12, .12), P.woodDark, 0, .8, 1.2)
    .add(geo.box(.2, 1.6, .2), P.woodDark, -5, -.2, -1.2).add(geo.box(.2, 1.6, .2), P.woodDark, 5, -.2, -1.2).add(geo.box(.2, 1.6, .2), P.woodDark, -5, -.2, 1.2).add(geo.box(.2, 1.6, .2), P.woodDark, 5, -.2, 1.2).mesh();

  /* ================= 기억의 돌 =================
   * setAwake(true) 로 빛을 켠다. 깨어난 정도 k(0..1)로 서서히 밝힐 수도 있다. */
  M.memoryStone = () => {
    const g = new T.Group();
    const base = B().add(geo.cyl(2.6, 2.9, .5, 9), P.stoneDark, 0, .25, 0).add(geo.cyl(.55, 1.05, 5.2, 5), P.stone, 0, 3.0, 0, { ry: .4, rz: .04 }).add(geo.cone(.56, .9, 5), P.stone, .06, 6.0, 0, { ry: .4 });
    const rng = G.makeRng(3);
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28; base.add(geo.cyl(.22, .3, .8 + rng() * .5, 5), P.stone, Math.cos(a) * 3.6, .5, Math.sin(a) * 3.6, { rz: rng() * .24 - .12 }); }
    base.add(geo.ico(.5), 0x4f7a4c, .5, 1.2, .5, { sx: 1.3, sy: .5 }).add(geo.ico(.4), 0x4f7a4c, -.4, 3.6, -.3, { sx: 1.2, sy: .5 });
    g.add(base.mesh());
    const runeMat = new T.MeshBasicMaterial({ color: 0x4e5560 });
    for (let i = 0; i < 3; i++) { const r = new T.Mesh(geo.tor(.8 - i * .1, .05, 4, 5), runeMat); r.rotation.x = Math.PI / 2; r.rotation.z = .4 + i * .5; r.position.y = 2 + i * 1.25; g.add(r); }
    const gem = new T.Mesh(geo.oct(.32), runeMat); gem.position.y = 7.1; g.add(gem);
    const light = new T.PointLight(P.glow, 0, 30, 1.4); light.position.y = 4; g.add(light);
    const dark = new T.Color(0x4e5560), lit = new T.Color(0xbffcff);
    g.userData = { gem, setAwake(k) { runeMat.color.copy(dark).lerp(lit, k); light.intensity = 22 * k; } };
    return g;
  };
})();
