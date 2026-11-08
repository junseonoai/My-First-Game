# 코드 적용

지금 사이트(online-onecard.onrender.com)에 한장을 입히는 순서다. 한 번에 다 바꾸지 않아도 된다 — 1~3단계만 해도 "다른 게임"처럼 보인다.

## 1단계 — 색·간격 변수 넣기

CSS 맨 위에 붙여 넣는다. 이후 모든 색·간격은 이 변수로만 쓴다.

```css
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600&family=Noto+Sans+KR:wght@400;500;700&display=swap");

/* 메이플스토리 Bold: 이 시스템의 fonts/MaplestoryBold.woff를 사이트의 /fonts/에 그대로 복사 */
@font-face { font-family: "Maplestory"; src: url("/fonts/MaplestoryBold.woff") format("woff"); font-weight: 700; font-display: swap; }

:root, [data-theme="light"] {
  --ground: #f0ead8;
  --raised: #fdfaf1;
  --sunken: #e6dfca;
  --ink: #1e1a15;
  --ink-muted: #585146;
  --line: #d8d0bb;
  --line-strong: #8a8172;
  --brand: #2b355c;
  --on-brand: #f0ead8;
  --brand-soft: #dde0ec;
  --brand-strong: #1f2745;
  --seal: #a8322d;
  --on-seal: #ffffff;
  --seal-soft: #f1d9d3;
  --seal-strong: #7a2726;
  --felt: #2a4434;
  --felt-deep: #1c3023;
  --on-felt: #f0ead8;
  --meok: #24262b;
  --meok-deep: #17181b;
  --meok-wash: #3a3d44;
  --on-meok: #f0ead8;
  --call: #b8923f;
  --call-soft: #e2c27a;
  --on-call: #1e1a15;
  --card-face: #faf8f2;
  --card-back: #2b355c;
  --card-back-pattern: #464f71;
  --suit-red: #9c3130;
  --suit-black: #1e1a15;
  --hint-counter: var(--seal);
  --hint-block: var(--call);
  --table-green: #2a4434;
  --table-navy: #2b3a59;
  --table-wine: #532430;
  --table-wood: #654c31;
  --table-charcoal: #2c2e32;
  --tier-silver: #b9bcc3;
  --tier-gold: #d9b54f;
  --tier-platinum: #7fb5ae;
  --tier-master: #b79be0;
  --tier-grandmaster: #d26a62;
  --focus: #2a5bd7;
  --shadow-card: 0 1px 0 rgba(30,26,21,0.10), 0 4px 10px rgba(10,20,14,0.30);
  --shadow-lift: 0 12px 26px rgba(10,20,14,0.40);
}
[data-theme="dark"] {
  --ground: #1a1b1f;
  --raised: #24262b;
  --sunken: #121316;
  --ink: #f0ead8;
  --ink-muted: #aaa190;
  --line: #33353b;
  --line-strong: #6b6e76;
  --brand: #9aa8dc;
  --on-brand: #141a30;
  --brand-soft: #232a47;
  --brand-strong: #c3cbef;
  --seal: #e0675f;
  --on-seal: #1a0d0c;
  --seal-soft: #3d1d1c;
  --seal-strong: #f0a39c;
  --felt: #2a4434;
  --felt-deep: #1c3023;
  --on-felt: #f0ead8;
  --meok: #24262b;
  --meok-deep: #17181b;
  --meok-wash: #3a3d44;
  --on-meok: #f0ead8;
  --call: #b8923f;
  --call-soft: #e2c27a;
  --on-call: #1e1a15;
  --card-face: #faf8f2;
  --card-back: #2b355c;
  --card-back-pattern: #464f71;
  --suit-red: #9c3130;
  --suit-black: #1e1a15;
  --hint-counter: #e0675f;
  --hint-block: #b8923f;
  --table-green: #2a4434;
  --table-navy: #2b3a59;
  --table-wine: #532430;
  --table-wood: #654c31;
  --table-charcoal: #2c2e32;
  --tier-silver: #b9bcc3;
  --tier-gold: #d9b54f;
  --tier-platinum: #7fb5ae;
  --tier-master: #b79be0;
  --tier-grandmaster: #d26a62;
  --focus: #7aa2ff;
  --shadow-card: 0 1px 0 rgba(0,0,0,0.4), 0 6px 14px rgba(0,0,0,0.5);
  --shadow-lift: 0 12px 28px rgba(0,0,0,0.6);
}
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-pill: 999px;
  --font-display: "Maplestory", "Noto Sans KR", system-ui, sans-serif;
  --font-sans: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}

/* 테이블 색 바꾸기: 고른 색을 --felt에 넣는다 */
[data-table="navy"] { --felt: var(--table-navy); }
[data-table="wine"] { --felt: var(--table-wine); }
[data-table="wood"] { --felt: var(--table-wood); }
[data-table="charcoal"] { --felt: var(--table-charcoal); }
/* 로비·대기실 바깥은 먹, 게임판은 펠트 */
body { background: var(--meok); color: var(--on-meok); font-family: var(--font-sans); }
.hj-meok { background: radial-gradient(ellipse at 30% 20%, var(--meok-wash) 0, transparent 60%), radial-gradient(ellipse at 80% 100%, var(--meok-deep) 0, transparent 55%), var(--meok); }
/* 게임판 요소(지금 코드의 게임 화면 최상위 요소)에 */
.board { background: var(--felt); color: var(--on-felt); }
```

다크 테마: `<html data-theme="dark">`. 기기 설정을 따르려면 처음 로드할 때

```js
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = localStorage.getItem('hj-theme') || (dark ? 'dark' : 'light');
```

## 2단계 — 이름·로고 교체

- `<title>`과 로비 제목을 [카피 사전] 대로 교체.
- 로비 상단 로고: `assets/Logos/hanjang-lockup.svg`를 `<img src="/logo.svg" alt="한장" height="40">`로. 다크 테마에서는 `hanjang-lockup-mono.svg`를 인라인 SVG로 넣고 `style="color: var(--ink)"`.
- 파비콘: `assets/Logos/favicon.svg`를 사이트 루트에 그대로.

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/icon-180.png">
<meta name="theme-color" content="#24262b">
```

## 3단계 — 링크 미리보기(카톡·디스코드 공유 시)

친구에게 링크를 보낼 때 보이는 카드다. 초대가 곧 홍보라 효과가 크다.

```html
<meta property="og:title" content="한장 — 친구들과 바로 원카드">
<meta property="og:description" content="설치 없이, 가입 없이. 방 코드 하나로 시작하는 원카드.">
<meta property="og:image" content="https://{주소}/og.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```

`og.png`는 1200×630: 먹 번짐 바탕 왼쪽에 한지색 둥근 패널 + 로고 가로 조합 + "마지막 한 장까지.", 오른쪽에 캐릭터 키 비주얼(`assets/Character/hanjang-character-keyart.jpg`를 잘라서). 캐릭터 그림을 아직 못 쓰면 기울어진 카드 2~3장(남색 뒷면 하나 포함).

## 4단계 — 컴포넌트 모양 맞추기

`components/bundle.css`의 `hj-` 클래스를 그대로 가져가 기존 요소에 붙인다. 예:

```html
<button class="hj-btn hj-btn--primary hj-btn--lg">방 만들기</button>
<div class="hj-card hj-card--md hj-card--red hj-card--playable" role="button" tabindex="0" aria-label="하트 7">…</div>
```

React로 옮길 계획이면 `components/bundle.js`의 `window.Hanjang.*` 컴포넌트를 그대로 쓰거나 참고해서 다시 짜면 된다. 속성 목록은 `components/index.d.ts`.

## 5단계 — 홈 화면에 추가(PWA, 선택)

```json
{
  "name": "한장 — 친구들과 바로 원카드",
  "short_name": "한장",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#24262b",
  "theme_color": "#24262b",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

## 바꾼 뒤 점검표

- [ ] 탭 제목·로비·링크 미리보기에 "원카드" 대신 "한장"이 보인다
- [ ] 코드에 색 hex 값이 직접 남아 있지 않다 (`#`로 검색)
- [ ] 버튼 높이 44px 이상, 화면당 primary 버튼 하나
- [ ] 다크 테마에서 모든 글자가 읽힌다
- [ ] 키보드 Tab으로 카드·버튼을 옮겨 다닐 때 파란 포커스 링이 보인다
- [ ] 움직임 줄이기를 켜면 배너·카드가 이동하지 않는다
- [ ] 휴대폰 세로 화면에서 로비의 "방 만들기"가 스크롤 없이 보인다
- [ ] 텍스트 이모지(♥♠)가 UI에 남아 있지 않다 (빠른 채팅의 이모지 반응은 예외)
- [ ] 패널·버튼의 각진 굵은 테두리와 딱딱한 그림자가 둥근 모서리·부드러운 그림자로 바뀌었다
- [ ] 칩·룰렛에 이름 말고 숫자나 금액이 없다
- [ ] 와인(#933231)·머스터드(#ccac52) 값이 코드에 남아 있지 않다
- [ ] 낙관 빨강(`seal`)이 주 버튼이나 넓은 면에 쓰이지 않았다
- [ ] 게임판은 여전히 펠트(사용자가 고른 테이블 색)다
