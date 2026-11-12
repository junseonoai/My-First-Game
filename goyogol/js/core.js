/* core.js — 전역 네임스페이스 G 와 공용 유틸.
 * 모든 파일은 <script> 로 순서대로 불러오며(모듈 아님), G 에 자기 영역을 붙인다.
 * 그래서 index.html 을 더블클릭해 file:// 로 열어도 실행된다. */
'use strict';
const G = window.G = {};

G.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
G.lerp = (a, b, t) => a + (b - a) * t;
G.ss = (a, b, x) => { const t = G.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
G.dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
/** a 에서 b 로 가는 가장 짧은 각도 차 (-PI..PI) */
G.angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
/** 시드 고정 난수. 월드 배치가 매번 같아야 저장 데이터(나무 번호 등)와 맞는다. */
G.makeRng = seed => { let s = seed; return () => (s = (s * 16807) % 2147483647, (s - 1) / 2147483646); };

/** 아주 단순한 이벤트 버스. 시스템끼리 직접 부르지 않고 이걸로 알린다. */
G.bus = (() => {
  const map = {};
  return {
    on(name, fn) { (map[name] = map[name] || []).push(fn); },
    emit(name, data) { (map[name] || []).forEach(fn => fn(data)); },
  };
})();

/** 색 팔레트 — 해질녘의 차분한 톤 + 청록 빛. docs/DESIGN.md 의 아트 방향 참고. */
G.PAL = {
  grass: 0x5f9a4c, grassDark: 0x447a45, forestFloor: 0x3c6b42, path: 0xa08a62, sand: 0x8c8768,
  rock: 0x737a80, rockDark: 0x596168, snow: 0xcdd8e2, water: 0x2f7482,
  trunk: 0x6b4a36, pine: [0x2f6b4d, 0x35785a, 0x2a5f52], leaf: [0x4f8f4a, 0x5f9d4e, 0x417f52], blossom: 0xd79ab5,
  wood: 0x9a7350, woodDark: 0x6b4a36, wall: 0xe2d6b8, stone: 0x8d9296, stoneDark: 0x6f7478,
  roofRed: 0xb4533c, roofBlue: 0x3f5878, roofGreen: 0x59764d, roofYellow: 0xc4913a, cloth: 0xe8dfc8,
  glow: 0x7ff0ff, warm: 0xffc46b,
  skin: 0xf0c9a4, hairSilver: 0xcfd6dc, hairTeal: 0x3fb5a8, cape: 0x3b3f8a, capeTrim: 0xc9d3dc, tunic: 0xe6dfcf, wrap: 0xd8cfb8,
  fogAsleep: 0x566572, fogAwake: 0x6f8a8c, skyTop: 0x1d2a3d, skyMid: 0x40596a, skyLow: 0xd0a878,
};

G.SAVE_KEY = 'goyogol-save-v1';
