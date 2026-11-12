/* ui.js — 화면 위 글자와 창: 체력·돈·할 일, 알림, 대화, 가방/상점/게시판 창, 기억 회상.
 * 3D 가 아닌 HTML 로 그린다(index.html 의 요소들). */
'use strict';
(() => {
  const $ = id => document.getElementById(id), D = G.DATA, S = G.sys;
  const U = G.ui = { dialogOpen: false, panelOpen: false, memoryOpen: false, titleOpen: true };
  Object.defineProperty(U, 'busy', { get: () => U.dialogOpen || U.panelOpen || U.memoryOpen || U.titleOpen });

  /* ---------- HUD ---------- */
  U.refresh = () => {
    $('hpFill').style.width = Math.max(0, S.hp / S.maxHp() * 100) + '%';
    $('hpTxt').textContent = `${Math.max(0, Math.ceil(S.hp))} / ${S.maxHp()}`;
    $('coin').textContent = `◈ ${S.coins}`;
    $('quest').innerHTML = S.tracker().map(q => `<div class="q"><b>${q.title}</b>${q.text}</div>`).join('');
    if (U.panelOpen && U.redraw) U.redraw();
  };
  G.bus.on('hud', U.refresh); G.bus.on('quest', U.refresh);
  G.bus.on('toast', msg => { const d = document.createElement('div'); d.textContent = msg; $('toast').appendChild(d); setTimeout(() => d.remove(), 3200); while ($('toast').children.length > 4) $('toast').firstChild.remove(); });
  U.setAction = label => { if ($('btnAct').textContent !== label) $('btnAct').textContent = label; };

  /* ---------- 대화 ---------- */
  let lines = [], li = 0, onDone = null;
  const showLine = () => { $('dName').textContent = lines[li][0]; $('dText').textContent = lines[li][1]; };
  /** lines = [[화자, 대사], ...]. 끝나면 cb 호출 */
  U.say = (ls, cb) => { lines = ls; li = 0; onDone = cb || null; U.dialogOpen = true; $('dialog').hidden = false; showLine(); };
  U.next = () => {
    if (!U.dialogOpen) return;
    if (++li < lines.length) return showLine();
    U.dialogOpen = false; $('dialog').hidden = true; const cb = onDone; onDone = null; if (cb) cb();
  };
  $('dialog').addEventListener('pointerdown', e => { e.preventDefault(); U.next(); });

  /* ---------- 창 ---------- */
  const open = (title, draw) => { U.panelOpen = true; U.redraw = draw; $('pTitle').textContent = title; $('panel').hidden = false; draw(); };
  U.close = () => { U.panelOpen = false; U.redraw = null; $('panel').hidden = true; };
  $('pClose').addEventListener('click', U.close);
  $('panel').addEventListener('pointerdown', e => { if (e.target === $('panel')) U.close(); });
  const row = (name, desc, qty, btns) => `<div class="row"><div class="nm">${name}<small>${desc}</small></div><div class="qty">${qty}</div>${btns || ''}</div>`;
  $('pBody').addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b && !b.disabled) acts[b.dataset.act](b.dataset.id); });
  const acts = {
    use: id => S.useItem(id),
    buy: id => { const g = D.shop.find(x => x.item === id); if (S.coins < g.price) return; S.addCoins(-g.price); S.add(id, 1); if (g.once && g.needs) S.take(g.needs, 1); S.save(); },
    sell: id => { if (S.take(id, 1)) { S.addCoins(D.items[id].sell); S.save(); } },
    sellAll: id => { const n = S.count(id); if (n && S.take(id, n)) { S.addCoins(D.items[id].sell * n); S.save(); } },
    board: () => { S.turnInBoard(); },
  };

  U.openBag = () => open('가방', () => {
    const ids = Object.keys(S.inv);
    let h = '<h3>가진 것</h3>' + (ids.length ? ids.map(id => { const it = D.items[id]; return row(it.name, it.desc, it.tool ? '' : '×' + S.inv[id], it.use ? `<button data-act="use" data-id="${id}">쓰기</button>` : ''); }).join('') : '<div class="empty">아직 아무것도 없다.</div>');
    h += '<h3>숙련도</h3>' + Object.keys(D.skills).map(id => { const sk = S.skills[id], need = S.xpNeed(sk.lv); return `<div class="row"><div class="nm">${D.skills[id].name} ${sk.lv}<small>${D.skills[id].desc}</small><div class="bar"><i style="width:${sk.xp / need * 100}%"></i></div></div></div>`; }).join('');
    $('pBody').innerHTML = h;
  });
  U.openShop = () => open('너울의 잡화점', () => {
    let h = `<h3>사기 — 가진 돈 ◈ ${S.coins}</h3>` + D.shop.filter(g => !(g.once && S.has(g.item)) && (!g.needs || S.has(g.needs) || S.has(g.item))).map(g => { const it = D.items[g.item]; return row(it.name, it.desc, '◈ ' + g.price, `<button data-act="buy" data-id="${g.item}" ${S.coins < g.price ? 'disabled' : ''}>사기</button>`); }).join('');
    const sell = Object.keys(S.inv).filter(id => D.items[id].sell);
    h += '<h3>팔기</h3>' + (sell.length ? sell.map(id => { const it = D.items[id]; return row(`${it.name} ×${S.inv[id]}`, `하나에 ◈ ${it.sell}`, '', `<button data-act="sell" data-id="${id}">1개</button><button data-act="sellAll" data-id="${id}">전부</button>`); }).join('') : '<div class="empty">팔 것이 없다.</div>');
    $('pBody').innerHTML = h;
  });
  U.openBoard = () => open('의뢰 게시판', () => {
    const j = S.boardJob(), it = D.items[j.item], have = S.count(j.item);
    $('pBody').innerHTML = `<h3>오늘의 의뢰</h3>` + row(j.text, `${it.name} ${j.n}개 (가진 것 ${have}개)`, '◈ ' + j.coins, `<button data-act="board" ${have < j.n ? 'disabled' : ''}>건네기</button>`) + '<div class="empty">의뢰를 끝내면 새 의뢰가 걸린다.</div>';
  });

  /* ---------- 기억 회상 ---------- */
  let mem = [], mi = 0, memDone = null;
  U.memory = (ls, cb) => { mem = ls; mi = 0; memDone = cb || null; U.memoryOpen = true; $('memory').hidden = false; $('mText').textContent = mem[0]; };
  U.memoryNext = () => {
    if (!U.memoryOpen) return;
    if (++mi < mem.length) { const p = $('mText'); p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; p.textContent = mem[mi]; return; }
    U.memoryOpen = false; $('memory').hidden = true; const cb = memDone; memDone = null; if (cb) cb();
  };
  $('memory').addEventListener('pointerdown', e => { e.preventDefault(); U.memoryNext(); });
  U.flash = on => { $('fade').style.opacity = on ? 1 : 0; };

  /* ---------- 제목 화면 ---------- */
  U.showTitle = (hasSave, onStart) => {
    $('btnContinue').hidden = !hasSave;
    const go = cont => { U.titleOpen = false; $('title').hidden = true; $('hud').hidden = false; onStart(cont); };
    $('btnContinue').onclick = () => go(true);
    $('btnNew').onclick = () => go(false);
  };
})();
