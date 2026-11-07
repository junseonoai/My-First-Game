/* @ds-bundle: {"format":4,"namespace":"Hanjang","components":[{"name":"Button"},{"name":"PlayingCard"},{"name":"RoomCode"},{"name":"PlayerChip"},{"name":"TurnTimer"},{"name":"CallBanner"},{"name":"TextField"},{"name":"Badge"},{"name":"QuickChat"}]} */
(function () {
  var R = window.React, h = R.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }

  var SUIT_PATH = {
    heart: 'M12 20.5s-8-4.6-8-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.5c0 5.8-8 10.4-8 10.4z',
    diamond: 'M12 2.5l7 9.5-7 9.5-7-9.5z',
    spade: 'M12 2.5S4 7.6 4 13.2A4 4 0 0 0 11 15.8L9.5 21h5L13 15.8a4 4 0 0 0 7-2.6C20 7.6 12 2.5 12 2.5z'
  };
  var SUIT_NAME = { heart: '하트', diamond: '다이아', spade: '스페이드', club: '클로버', joker: '조커' };

  function SuitIcon(p) {
    var size = p.size || 16;
    var kids = p.suit === 'club'
      ? [h('circle', { key: 1, cx: 12, cy: 7.2, r: 4 }), h('circle', { key: 2, cx: 7, cy: 13.4, r: 4 }), h('circle', { key: 3, cx: 17, cy: 13.4, r: 4 }), h('path', { key: 4, d: 'M11 12h2l1.5 9h-5z' })]
      : [h('path', { key: 1, d: SUIT_PATH[p.suit] || SUIT_PATH.spade })];
    return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor', 'aria-hidden': true, className: p.className }, kids);
  }

  function Button(p) {
    var variant = p.variant || 'secondary', size = p.size || 'md';
    var rest = Object.assign({}, p); delete rest.variant; delete rest.size; delete rest.icon; delete rest.className; delete rest.children;
    return h('button', Object.assign({ type: 'button' }, rest, { className: cx('hj-btn', 'hj-btn--' + variant, 'hj-btn--' + size, p.className) }),
      p.icon ? h('span', { className: 'hj-btn__icon', 'aria-hidden': true }, p.icon) : null,
      h('span', null, p.children));
  }

  function PlayingCard(p) {
    var size = p.size || 'md', state = p.state || 'normal';
    if (p.faceDown) {
      return h('div', { className: cx('hj-card', 'hj-card--back', 'hj-card--' + size), role: 'img', 'aria-label': '뒷면 카드' },
        h('span', { className: 'hj-card__backmark', 'aria-hidden': true }, h('svg', { viewBox: '6 4 108 108' }, h('path', { d: 'M50 14H70M26 34H94', stroke: 'currentColor', strokeWidth: 11, strokeLinecap: 'round', fill: 'none' }), h('path', { transform: 'translate(60 80) scale(1.7) translate(-60 -70)', fill: 'currentColor', d: 'M60 51C60 51 41 63 41 73.5A9 9 0 0 0 56.5 79.5L53.5 88H66.5L63.5 79.5A9 9 0 0 0 79 73.5C79 63 60 51 60 51Z' }))));
    }
    var suit = p.suit || 'spade', red = suit === 'heart' || suit === 'diamond';
    var label = (p.suit === 'joker' ? (p.rank === 'color' ? '컬러 조커' : '흑백 조커') : SUIT_NAME[suit] + ' ' + p.rank);
    var cls = cx('hj-card', 'hj-card--' + size, 'hj-card--' + state, red ? 'hj-card--red' : 'hj-card--black', p.attack && 'hj-card--attack', p.hint && 'hj-card--hint-' + p.hint);
    var HINT = { counter: ' (받아치기 가능)', block: ' (막기 가능)', joker: ' (조커)' };
    var props = { className: cls, 'aria-label': label + (p.attack ? ' (공격)' : '') + (p.hint ? HINT[p.hint] || '' : '') };
    if (p.onClick) { props.onClick = p.onClick; props.role = 'button'; props.tabIndex = state === 'disabled' ? -1 : 0; props['aria-pressed'] = state === 'selected'; props['aria-disabled'] = state === 'disabled'; }
    else props.role = 'img';
    if (suit === 'joker') {
      return h('div', props, h('span', { className: 'hj-card__joker' }, 'JOKER'));
    }
    return h('div', props,
      h('span', { className: 'hj-card__corner' }, h('span', { className: 'hj-card__rank' }, p.rank), h(SuitIcon, { suit: suit, size: size === 'sm' ? 11 : 14 })),
      h(SuitIcon, { suit: suit, size: size === 'sm' ? 22 : 32, className: 'hj-card__pip' }),
      p.attack ? h('span', { className: 'hj-card__flag', 'aria-hidden': true }, '공격') : null);
  }

  function RoomCode(p) {
    var st = R.useState(false), copied = st[0], setCopied = st[1];
    function copy() {
      try { navigator.clipboard && navigator.clipboard.writeText(p.code); } catch (e) {}
      setCopied(true); if (p.onCopy) p.onCopy(p.code);
      setTimeout(function () { setCopied(false); }, 1600);
    }
    return h('div', { className: 'hj-room' },
      h('span', { className: 'hj-room__label' }, p.label || '방 코드'),
      h('span', { className: 'hj-room__code', 'aria-label': '방 코드 ' + String(p.code).split('').join(' ') }, p.code),
      h('button', { type: 'button', className: 'hj-room__copy', onClick: copy }, copied ? '복사됨' : '복사'),
      h('span', { className: 'hj-sr', 'aria-live': 'polite' }, copied ? '방 코드를 복사했어요' : ''));
  }

  var TIER = { silver: '실버', gold: '골드', platinum: '플래티넘', master: '마스터', grandmaster: '그랜드마스터' };
  function PlayerChip(p) {
    var status = p.offline ? '재접속 대기' : p.oneCard ? '원카드!' : p.cards + '장';
    var tag = p.active ? '차례' : p.next ? '다음' : null;
    return h('div', { className: cx('hj-seat', p.active && 'hj-seat--active', p.next && 'hj-seat--next', p.oneCard && 'hj-seat--one', p.offline && 'hj-seat--off'), 'aria-current': p.active ? 'true' : undefined,
        'aria-label': p.name + (p.me ? '(나)' : '') + ', ' + status + (tag ? ', ' + tag : '') },
      p.tier ? h('span', { className: 'hj-badge hj-badge--' + p.tier + ' hj-seat__tier' }, TIER[p.tier]) : (p.host ? h('span', { className: 'hj-badge hj-badge--neutral hj-seat__tier' }, '방장') : null),
      h('span', { className: 'hj-seat__name' }, p.name, p.me ? h('span', { className: 'hj-seat__me' }, ' (나)') : null),
      h('span', { className: 'hj-seat__fan', 'aria-hidden': true }, h('i'), h('i'), h('i')),
      h('span', { className: 'hj-seat__count' }, status),
      tag ? h('span', { className: 'hj-seat__tag' }, tag) : null);
  }

  function TurnTimer(p) {
    var total = p.total || 30, left = Math.max(0, Math.min(total, p.seconds));
    var pct = (left / total) * 100, urgent = left <= 5;
    return h('div', { className: cx('hj-timer', urgent && 'hj-timer--urgent', p.waiting && 'hj-timer--wait'), role: 'timer', 'aria-label': (p.label || '내 차례') + ', 남은 시간 ' + left + '초' },
      h('span', { className: 'hj-timer__track' }, h('span', { className: 'hj-timer__fill', style: { width: pct + '%' } })),
      h('span', { className: 'hj-timer__label' }, p.label || '내 차례', p.waiting ? null : h('b', { className: 'hj-timer__num' }, left)));
  }

  function CallBanner(p) {
    var kind = p.kind || 'onecard';
    var title = p.title || (kind === 'onecard' ? '원카드!' : kind === 'attack' ? '공격 +' + (p.amount || 2) : '승리!');
    return h('div', { className: cx('hj-call', 'hj-call--' + kind), role: 'status' },
      h('span', { className: 'hj-call__title' }, title),
      p.detail ? h('span', { className: 'hj-call__detail' }, p.detail) : null);
  }

  function TextField(p) {
    var id = p.id || ('hj-f-' + (p.label || 'x'));
    var rest = Object.assign({}, p); delete rest.label; delete rest.hint; delete rest.error; delete rest.code;
    return h('label', { className: cx('hj-field', p.error && 'hj-field--error'), htmlFor: id },
      h('span', { className: 'hj-field__label' }, p.label),
      h('input', Object.assign({ id: id, className: cx('hj-field__input', p.code && 'hj-field__input--code'), 'aria-invalid': p.error ? true : undefined }, rest)),
      (p.error || p.hint) ? h('span', { className: 'hj-field__hint' }, p.error || p.hint) : null);
  }

  var PHRASES = ['빨리 내요!', '잘했어요', '아 안 돼!', '봐주세요', '원카드 조심!', '공격 간다!', '운이 좋네요', '한 판 더?', 'ㅋㅋㅋㅋ', '안녕하세요'];
  function QuickChat(p) {
    var list = p.phrases || PHRASES;
    return h('div', { className: 'hj-chat', role: 'group', 'aria-label': '빠른 채팅' },
      list.map(function (t) { return h('button', { key: t, type: 'button', className: 'hj-chat__btn', onClick: p.onSend ? function () { p.onSend(t); } : undefined }, t); }));
  }

  function Badge(p) {
    return h('span', { className: cx('hj-badge', 'hj-badge--' + (p.tone || 'neutral')) }, p.children);
  }

  window.Hanjang = Object.assign(window.Hanjang || {}, { Button: Button, PlayingCard: PlayingCard, RoomCode: RoomCode, PlayerChip: PlayerChip, TurnTimer: TurnTimer, CallBanner: CallBanner, TextField: TextField, Badge: Badge, QuickChat: QuickChat, SuitIcon: SuitIcon });
})();
