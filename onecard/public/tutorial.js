// 튜토리얼: 규칙을 하나씩 보여 주고, 직접 눌러 보는 문제와 원카드 버튼 연습을 한다
(() => {
  const $ = (id) => document.getElementById(id);
  const C = (suit, rank, id) => ({ suit, rank, id: id ?? Math.floor(Math.random() * 1e6) });
  const card = (c) => window.oneCardUI.cardEl(c);
  const row = (...els) => { const d = document.createElement('div'); d.className = 'tu-row'; els.forEach((e) => d.appendChild(e)); return d; };
  const label = (el, text) => { const w = document.createElement('div'); w.className = 'tu-lab'; w.appendChild(el); const t = document.createElement('span'); t.textContent = text; w.appendChild(t); return w; };
  const note = (text, cls = '') => { const p = document.createElement('p'); p.className = 'tu-note ' + cls; p.textContent = text; return p; };

  // 고르기 문제: 맞는 카드를 모두 고르고 '확인'
  function quiz({ top, topNote, hand, answer, ok, hint }) {
    const box = document.createElement('div');
    box.className = 'tu-quiz';
    box.appendChild(row(label(card(top), topNote || '바닥 카드')));
    const handRow = row();
    const picked = new Set();
    hand.forEach((c, i) => {
      const el = card({ ...c, id: i });
      el.classList.add('tu-pick');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const toggle = () => { picked.has(i) ? picked.delete(i) : picked.add(i); el.classList.toggle('on', picked.has(i)); };
      el.onclick = toggle;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
      handRow.appendChild(el);
    });
    box.appendChild(handRow);
    const res = note('');
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = '확인';
    btn.onclick = () => {
      const good = answer.length === picked.size && answer.every((i) => picked.has(i));
      res.className = 'tu-note ' + (good ? 'good' : 'bad');
      res.textContent = good ? ok : hint;
      handRow.querySelectorAll('.card').forEach((el, i) => el.classList.toggle('ans', good && answer.includes(i)));
    };
    box.appendChild(btn);
    box.appendChild(res);
    return box;
  }

  // 원카드 버튼 연습: 무작위로 기다렸다가 버튼이 뜨면 누르기
  function oneCardDrill() {
    const box = document.createElement('div');
    box.className = 'tu-drill';
    const stage = document.createElement('button');
    stage.className = 'tu-stage';
    stage.textContent = '여기를 눌러 시작';
    const out = note('봇 반응: 실버 3~5.5초 · 골드 1.8~3.5초 · 플래티넘 1.2~2.4초 · 마스터 0.8~1.6초 · 그랜드마스터 0.5~1초');
    let phase = 'idle', shownAt = 0, timer = null;
    const tierFor = (ms) => ms <= 1000 ? '그랜드마스터급' : ms <= 1600 ? '마스터급' : ms <= 2400 ? '플래티넘급' : ms <= 3500 ? '골드급' : '실버급';
    stage.onclick = () => {
      if (phase === 'idle' || phase === 'done') {
        phase = 'wait';
        stage.className = 'tu-stage wait';
        stage.textContent = '기다리세요…';
        timer = setTimeout(() => {
          phase = 'go'; shownAt = performance.now();
          stage.className = 'tu-stage go';
          stage.textContent = '원카드!';
        }, 1200 + Math.random() * 2500);
      } else if (phase === 'wait') {
        clearTimeout(timer);
        phase = 'done';
        stage.className = 'tu-stage';
        stage.textContent = '너무 빨라요! 다시 하기';
      } else if (phase === 'go') {
        const ms = performance.now() - shownAt;
        phase = 'done';
        stage.className = 'tu-stage';
        stage.textContent = `${(ms / 1000).toFixed(2)}초 · ${tierFor(ms)} — 다시 하기`;
      }
    };
    box.appendChild(stage);
    box.appendChild(out);
    return box;
  }

  const steps = [
    {
      title: '목표',
      body: '모두 7장씩 받고 시작해요. 손에 든 카드를 가장 먼저 다 내는 사람이 이겨요.',
      demo: () => row(...[C('S', '4'), C('H', '9'), C('D', 'K'), C('C', '7'), C('H', '2'), C('S', 'Q'), C('D', 'A')].map(card)),
    },
    {
      title: '카드 내기',
      body: '바닥 카드와 무늬가 같거나 숫자가 같은 카드를 낼 수 있어요. 낼 카드가 없으면 카드 뽑기를 눌러 1장 가져와요.',
      demo: () => quiz({
        top: C('H', '5'), hand: [C('S', '5'), C('C', '9'), C('H', 'K'), C('D', '2')], answer: [0, 2],
        ok: '맞아요! ♠5는 숫자가, ♥K는 무늬가 같아요.', hint: '바닥은 ♥5예요. 하트이거나 5인 카드를 모두 골라 보세요.',
      }),
      task: '낼 수 있는 카드를 모두 골라 보세요.',
    },
    {
      title: '공격 카드',
      body: '공격 카드를 내면 다음 사람이 그만큼 카드를 먹어요. 공격은 계속 쌓일 수 있어요.',
      demo: () => row(label(card(C('H', '2')), '2장'), label(card(C('D', 'A')), '3장'), label(card(C('S', 'A')), '5장'), label(card(C('BJ', 'JOKER')), '5장'), label(card(C('CJ', 'JOKER')), '7장')),
    },
    {
      title: '받아치기와 막기',
      body: '공격을 받으면 무늬나 숫자가 맞는 공격 카드로 받아쳐서 다음 사람에게 넘길 수 있어요(빨간 테두리). 2나 A 공격은 같은 무늬 3으로 막을 수 있어요(노란 테두리).',
      demo: () => quiz({
        top: C('H', '2'), topNote: '공격 2장', hand: [C('C', '2'), C('H', '3'), C('H', '9'), C('S', 'A')], answer: [0, 1],
        ok: '정답! ♣2로 받아치면 4장이 다음 사람에게 가고, ♥3으로 막으면 공격이 사라져요.', hint: '♥9는 공격 카드가 아니고, ♠A는 무늬도 숫자도 달라요.',
      }),
      task: '받아치거나 막을 수 있는 카드를 모두 골라 보세요.',
    },
    {
      title: '조커',
      body: '조커는 언제든 낼 수 있어요. 조커 공격은 다른 조커나 A♠로만 받아칠 수 있어요. 낼 수 있는 조커는 무지개 테두리로 보여요.',
      demo: () => row(label(card(C('BJ', 'JOKER')), '흑백 조커'), label(card(C('CJ', 'JOKER')), '컬러 조커'), label(card(C('S', 'A')), '조커를 받아치는 A♠')),
    },
    {
      title: '특수 카드',
      body: 'J는 다음 사람을 건너뛰고, Q는 도는 방향을 바꾸고, K를 내면 한 번 더 내요. 7을 내면 원하는 무늬로 바꿀 수 있어요.',
      demo: () => row(label(card(C('S', 'J')), '건너뛰기'), label(card(C('H', 'Q')), '방향 바꾸기'), label(card(C('C', 'K')), '한 번 더'), label(card(C('D', '7')), '무늬 바꾸기')),
    },
    {
      title: '같은 숫자 여러 장',
      body: '같은 숫자는 여러 장을 한 번에 낼 수 있어요. 첫 장만 낼 수 있으면 돼요. 카드를 누르면 같은 숫자가 초록 테두리로 보이고, 고른 순서대로 나가요. 마지막 카드가 바닥 맨 위에 와요.',
      demo: () => {
        const r = row(card(C('H', '7')), card(C('S', '7')), card(C('D', '7')));
        r.querySelectorAll('.card').forEach((el, i) => { el.classList.add('tu-sel'); el.insertAdjacentHTML('beforeend', `<span class="sel-no">${i + 1}</span>`); });
        return r;
      },
    },
    {
      title: '원카드!',
      body: '누군가 한 장 남으면 모두의 화면에 원카드 버튼이 떠요. 가장 먼저 누른 사람이 이겨요. 본인이 먼저 누르면 안전하고, 다른 사람이 먼저 누르면 1장 벌칙이에요. 누른 뒤에는 모두의 반응 속도가 나와요.',
      demo: oneCardDrill,
      task: '버튼이 뜨면 최대한 빨리 눌러 보세요.',
    },
    {
      title: '파산과 봇 등급',
      body: '손패가 30장이 되면 파산이에요. 대기실에서 봇 추가를 누르면 실버부터 그랜드마스터까지 봇 등급을 골라 연습할 수 있어요. 이제 방을 만들어 시작해 보세요!',
      demo: () => {
        const d = document.createElement('div');
        d.className = 'tu-tiers';
        for (const [t, n] of [['silver', '실버'], ['gold', '골드'], ['platinum', '플래티넘'], ['master', '마스터'], ['grandmaster', '그랜드마스터']]) d.insertAdjacentHTML('beforeend', `<span class="tier t-${t}">${n}</span>`);
        return d;
      },
    },
  ];

  let at = 0;
  function show(i) {
    at = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[at];
    $('tuStep').textContent = `${at + 1} / ${steps.length}`;
    $('tuTitle').textContent = s.title;
    $('tuBody').textContent = s.body;
    $('tuTask').textContent = s.task || '';
    $('tuTask').hidden = !s.task;
    const demo = $('tuDemo');
    demo.innerHTML = '';
    demo.appendChild(s.demo());
    $('tuPrev').disabled = at === 0;
    $('tuNext').textContent = at === steps.length - 1 ? '시작하기' : '다음';
    $('tuDots').innerHTML = steps.map((_, k) => `<i class="${k === at ? 'on' : ''}"></i>`).join('');
  }
  function open() { $('tutorial').hidden = false; show(0); }
  function close() {
    $('tutorial').hidden = true;
    try { localStorage.setItem('onecard-tutorial-done', '1'); } catch {}
    $('tutorialHint').hidden = true;
  }
  $('btnTutorial').onclick = open;
  $('tuClose').onclick = close;
  $('tuPrev').onclick = () => show(at - 1);
  $('tuNext').onclick = () => (at === steps.length - 1 ? close() : show(at + 1));
  // 처음 온 사람에게는 튜토리얼을 권한다
  let done = false;
  try { done = !!localStorage.getItem('onecard-tutorial-done'); } catch {}
  $('tutorialHint').hidden = done;
})();
