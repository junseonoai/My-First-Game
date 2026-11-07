# PlayerChip

화면 위쪽 줄에 앉은 상대 한 명의 자리. 이름, 카드 뒷면 3장 부채, 남은 장수, 봇 등급, 차례 표시.

- 바탕은 `felt-deep`, 글자는 `on-felt`. 자리들은 진행 방향 화살표(`call` 색 작은 꺾쇠)로 이어 놓는다.
- **차례**(`active`): 자리가 종이색(`ground`)으로 뒤집히고 `call` 테두리, 아래에 "차례" 알약.
- **다음**(`next`): 점선 테두리 + "다음" 알약. 방향이 바뀌면(Q) 즉시 옮긴다.
- **원카드**(`oneCard`): 장수 자리가 `call` 바탕의 "원카드!"로 바뀐다.
- **재접속 대기**(`offline`): 흐려지고 "재접속 대기". 1분 지나면 자리에서 빠진다.
- 봇은 등급 배지(`tier`: silver·gold·platinum·master·grandmaster), 사람 방장은 "방장" 배지. 배지는 오른쪽 위 모서리에 걸친다.
- 사용하는 쪽이 넣는 것: `name`, `cards`, `tier`, `active`, `next`, `oneCard`, `offline`, `host`, `me`.
