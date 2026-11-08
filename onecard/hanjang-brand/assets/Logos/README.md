# Logos

컬러 파일은 색이 고정이라 `<img>`로 바로 쓴다. `-mono`, `wordmark`, `submark`는 `currentColor`로 그려져 있어서 인라인 SVG로 넣고 CSS `color`를 줘야 색이 바뀐다(`<img>`로 넣으면 검정). 단색은 `ink`(먹 #1e1a15).

- `hanjang-lockup.svg` — 기본 로고. 먹(#1e1a15) 말풍선 카드 심볼(안쪽 #fdfaf1) + 낙관 도장(#a8322d, 안에 흰 ㅎ 스페이드) + 먹 "한장" 글자. 한지 바탕용.
- `hanjang-lockup-mono.svg` — 가로 조합 단색. 심볼 안쪽 ㅎ 스페이드는 뚫려 있음.
- `hanjang-lockup-reverse.svg` — 먹 배경(#24262b) 위용. 한지색(#f0ead8) 심볼(안쪽 먹색) + 낙관 도장 + 한지색 글자.
- `hanjang-symbol.svg` — 심볼만, 컬러(먹 + 낙관 도장).
- `hanjang-symbol-mono.svg` — 심볼만, 단색(안쪽 뚫림).
- `hanjang-wordmark.svg` — 메이플스토리 Bold를 윤곽선으로 바꾼 "한장" 글자, 단색.
- `hanjang-submark.svg` — 보조 심볼 ㅎ 스페이드, 단색. 24px 이하와 카드 뒷면.
- `favicon.svg` — 단색 ㅎ 스페이드. 16px에서도 보이게 획을 두껍게 조정한 버전. 밝은 탭에서는 먹(#1e1a15), 어두운 탭에서는 한지색(#f0ead8)으로 바뀐다(SVG 안의 `prefers-color-scheme`).
- `hanjang-app-icon.svg` — 먹(#24262b) 바탕 앱 아이콘, 한지색 말풍선 카드에 먹 ㅎ 스페이드 + 낙관 도장.
