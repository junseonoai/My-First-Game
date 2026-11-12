/* input.js — 키보드, 마우스, 터치를 하나의 입력 상태(G.input)로 모은다.
 *   mx, mz        이동 (-1..1). mz = 앞(+)/뒤(-), mx = 오른쪽(+)/왼쪽(-) — 카메라 기준
 *   action, roll  이번 프레임에 눌렸는가 (main.js 가 프레임 끝에 지운다)
 *   camDX, camDY  이번 프레임의 시점 드래그 양(픽셀)
 *   zoom          휠 줌 */
'use strict';
(() => {
  const I = G.input = { mx: 0, mz: 0, action: false, roll: false, camDX: 0, camDY: 0, zoom: 0, lastDrag: -10 };
  const keys = new Set(), $ = id => document.getElementById(id), canvas = $('c'), stick = $('stick'), knob = stick.firstElementChild;
  let joy = null, cam = null;   // 각각 { id, x, y }

  addEventListener('keydown', e => {
    if (e.repeat) return;
    const k = e.key.toLowerCase(); keys.add(k);
    if (k === ' ' || k === 'e' || k === 'j' || k === 'enter') { e.preventDefault(); if (G.ui.dialogOpen) G.ui.next(); else if (G.ui.memoryOpen) G.ui.memoryNext(); else I.action = true; }
    if (k === 'shift' || k === 'k') I.roll = true;
    if (k === 'i' || k === 'tab') { e.preventDefault(); if (G.ui.panelOpen) G.ui.close(); else if (!G.ui.busy) G.ui.openBag(); }
    if (k === 'escape' && G.ui.panelOpen) G.ui.close();
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', e => {
    if (G.ui.busy) return;
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse' && e.clientX < innerWidth * .45 && !joy) {
      joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
      stick.style.display = 'block'; stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px'; knob.style.transform = '';
    } else if (!cam) cam = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', e => {
    if (joy && e.pointerId === joy.id) {
      let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const d = Math.hypot(dx, dy), R = 50;
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`; I.jx = dx / R; I.jz = -dy / R;
    } else if (cam && e.pointerId === cam.id) {
      I.camDX += e.clientX - cam.x; I.camDY += e.clientY - cam.y; cam.x = e.clientX; cam.y = e.clientY; I.lastDrag = performance.now() / 1000;
    }
  });
  const up = e => {
    if (joy && e.pointerId === joy.id) { joy = null; I.jx = I.jz = 0; stick.style.display = 'none'; }
    if (cam && e.pointerId === cam.id) cam = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { I.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  const press = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
  press('btnAct', () => { if (G.ui.dialogOpen) G.ui.next(); else if (!G.ui.busy) I.action = true; });
  press('btnRoll', () => { if (!G.ui.busy) I.roll = true; });
  press('btnBag', () => { if (!G.ui.busy) G.ui.openBag(); });

  I.jx = I.jz = 0;
  /** 프레임마다 호출: 키보드와 조이스틱을 합쳐 이동 값을 낸다 */
  I.poll = () => {
    let x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let z = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    x += I.jx; z += I.jz;
    const d = Math.hypot(x, z); if (d > 1) { x /= d; z /= d; }
    I.mx = x; I.mz = z;
  };
  I.endFrame = () => { I.action = I.roll = false; I.camDX = I.camDY = 0; I.zoom = 0; };
})();
