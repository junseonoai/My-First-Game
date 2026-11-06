// 원카드 게임 규칙 (서버 전용, 순수 로직)
//
// 기본: 무늬(suit) 또는 숫자(rank)가 같으면 낼 수 있다. 조커는 언제든 낼 수 있다.
// 공격: 2 → 2장, A → 3장, A♠ → 5장, 흑백 조커 → 5장, 컬러 조커 → 7장 (누적)
//   공격받는 중에는 공격 카드(무늬/숫자 일치) 또는 조커로 되받아치거나 (A 공격도 2로 받아칠 수 있음),
//   조커 공격은 조커나 A♠로만 받아칠 수 있다.
//   2 공격에 같은 무늬의 3을 내면 방어(공격 무효). 못 막으면 쌓인 장수만큼 먹는다.
// 특수: J 다음 사람 건너뛰기, Q 방향 바꾸기, K 한 번 더, 7 무늬 바꾸기
// 한 장 남으면 '원카드!'를 외쳐야 한다. 다른 사람이 먼저 누르면 1장 벌칙.
// 손패가 20장 이상이면 파산(탈락). 마지막까지 남은 순서대로 순위.

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const START_HAND = 7;
const BANKRUPT = 20;
const MAX_TURNS = 500;

function makeDeck() {
  const deck = [];
  let id = 0;
  for (const s of SUITS) for (const r of RANKS) deck.push({ id: id++, suit: s, rank: r });
  deck.push({ id: id++, suit: 'BJ', rank: 'JOKER' }); // 흑백 조커
  deck.push({ id: id++, suit: 'CJ', rank: 'JOKER' }); // 컬러 조커
  return deck;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isJoker = (c) => c.rank === 'JOKER';

function attackValue(c) {
  if (c.suit === 'CJ') return 7;
  if (c.suit === 'BJ') return 5;
  if (c.rank === 'A') return c.suit === 'S' ? 5 : 3;
  if (c.rank === '2') return 2;
  return 0;
}

class Game {
  constructor(players) {
    // players: [{ id, name, bot }]
    this.players = players.map((p) => ({ ...p, hand: [], out: false, rank: 0, bankrupt: false }));
    this.deck = shuffle(makeDeck());
    this.discard = [];
    this.dir = 1;
    this.turn = Math.floor(Math.random() * this.players.length);
    this.penalty = 0; // 누적 공격 장수
    this.activeSuit = null; // 7로 바꾼 무늬 / 조커 이후 자유(null = 아무거나)
    this.oneCard = null; // { playerId } 원카드 외치기 대기
    this.finished = false;
    this.nextRank = 1;
    this.log = [];

    for (const p of this.players) p.hand = this.deck.splice(0, START_HAND);
    // 첫 카드는 특수/공격 카드가 아닌 것으로
    let idx = this.deck.findIndex((c) => !isJoker(c) && attackValue(c) === 0 && !['7', 'J', 'Q', 'K'].includes(c.rank));
    const first = this.deck.splice(idx, 1)[0];
    this.discard.push(first);
    this.activeSuit = first.suit;
    this.addLog(`게임 시작! ${this.cur().name}님부터 시작합니다.`);
  }

  top() { return this.discard[this.discard.length - 1]; }
  cur() { return this.players[this.turn]; }
  alive() { return this.players.filter((p) => !p.out); }
  find(id) { return this.players.find((p) => p.id === id); }
  addLog(msg) { this.logSeq = (this.logSeq || 0) + 1; this.log.push(msg); if (this.log.length > 40) this.log.shift(); }

  canPlay(card) {
    const top = this.top();
    if (this.penalty > 0) {
      if (isJoker(card)) return true;
      // 조커 공격은 조커 또는 A♠로 받아칠 수 있다
      if (isJoker(top)) return card.rank === 'A' && card.suit === 'S';
      // 2 공격 → 같은 무늬 3으로 방어
      if (top.rank === '2' && card.rank === '3' && card.suit === top.suit) return true;
      if (attackValue(card) === 0) return false;
      return card.suit === top.suit || card.rank === top.rank;
    }
    if (isJoker(card)) return true;
    if (this.activeSuit === null) return true; // 조커 뒤 아무 카드
    return card.suit === this.activeSuit || (!isJoker(top) && card.rank === top.rank);
  }

  advance(steps = 1) {
    const n = this.players.length;
    let t = this.turn;
    let moved = 0;
    while (moved < steps) {
      t = (t + this.dir + n) % n;
      if (!this.players[t].out) moved++;
    }
    this.turn = t;
  }

  refillDeck() {
    if (this.deck.length > 0 || this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.deck = shuffle(this.discard);
    this.discard = [top];
    this.addLog('버린 카드를 섞어 덱을 다시 만들었습니다.');
  }

  drawCards(player, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      this.refillDeck();
      if (this.deck.length === 0) break;
      player.hand.push(this.deck.pop());
      got++;
    }
    if (this.oneCard && this.oneCard.playerId === player.id && player.hand.length > 1) this.oneCard = null;
    if (player.hand.length >= BANKRUPT) this.eliminate(player);
    return got;
  }

  eliminate(player) {
    player.out = true;
    player.bankrupt = true;
    this.discard.splice(0, 0, ...player.hand); // 바닥 아래로
    player.hand = [];
    this.addLog(`💥 ${player.name}님 파산! (${BANKRUPT}장 이상)`);
    this.checkEnd();
  }

  finish(player) {
    player.out = true;
    player.rank = this.nextRank++;
    this.addLog(`🏆 ${player.name}님 ${player.rank}등!`);
    this.checkEnd();
  }

  checkEnd() {
    const alive = this.alive();
    if (alive.length <= 1) {
      for (const p of alive) { p.out = true; p.rank = this.nextRank++; }
      this.finished = true;
      this.addLog('게임 종료!');
    }
  }

  // 남은 사람들을 손패가 적은 순서로 순위 매기고 종료
  endByCount(reason) {
    this.addLog(`${reason} 손패가 적은 순서로 순위를 정합니다.`);
    for (const q of this.alive().sort((a, b) => a.hand.length - b.hand.length)) { q.out = true; q.rank = this.nextRank++; }
    this.finished = true;
    this.addLog('게임 종료!');
  }

  // 차례가 끝날 때마다 호출: 너무 길어진 판은 판정으로 끝낸다
  tick() {
    this.turns = (this.turns || 0) + 1;
    if (!this.finished && this.turns >= MAX_TURNS) this.endByCount(`${MAX_TURNS}턴이 지났어요.`);
  }

  // 반환: { ok, error }
  play(playerId, cardId, chosenSuit) {
    if (this.finished) return { ok: false, error: '게임이 끝났습니다.' };
    const p = this.cur();
    if (p.id !== playerId) return { ok: false, error: '내 차례가 아닙니다.' };
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, error: '없는 카드입니다.' };
    const card = p.hand[idx];
    if (!this.canPlay(card)) return { ok: false, error: '낼 수 없는 카드입니다.' };
    if (card.rank === '7' && this.penalty === 0 && !SUITS.includes(chosenSuit)) {
      return { ok: false, error: '바꿀 무늬를 골라주세요.' };
    }

    p.hand.splice(idx, 1);
    this.discard.push(card);
    this.stall = 0;
    const label = cardLabel(card);

    // 원카드 상태 갱신: 한 장 남으면 외치기 대기 (누군가 버튼을 누를 때까지 유지)
    if (p.hand.length === 1) this.oneCard = { playerId: p.id };
    else if (this.oneCard && this.oneCard.playerId === p.id) this.oneCard = null;

    let msg = `${p.name}: ${label}`;
    let steps = 1;
    let again = false;

    if (isJoker(card)) {
      this.penalty += attackValue(card);
      this.activeSuit = null;
      msg += ` (공격 +${attackValue(card)}, 누적 ${this.penalty})`;
    } else if (this.penalty > 0 && card.rank === '3') {
      this.penalty = 0;
      this.activeSuit = card.suit;
      msg += ' 🛡️ 방어!';
    } else if (attackValue(card) > 0) {
      this.penalty += attackValue(card);
      this.activeSuit = card.suit;
      msg += ` (공격 +${attackValue(card)}, 누적 ${this.penalty})`;
    } else {
      this.activeSuit = card.suit;
      if (card.rank === '7') {
        this.activeSuit = chosenSuit;
        msg += ` → ${SUIT_NAME[chosenSuit]}(으)로 변경`;
      } else if (card.rank === 'J') {
        steps = 2;
        msg += ' (건너뛰기)';
      } else if (card.rank === 'Q') {
        this.dir *= -1;
        msg += ' (방향 전환)';
      } else if (card.rank === 'K') {
        again = true;
        msg += ' (한 번 더)';
      }
    }
    this.addLog(msg);

    if (p.hand.length === 0) {
      this.finish(p);
      if (this.finished) return { ok: true };
      this.advance(1);
      return { ok: true };
    }

    this.tick();
    if (this.finished) return { ok: true };
    if (!again) {
      // 두 명일 때 Q는 한 번 더와 같음
      if (card.rank === 'Q' && this.alive().length === 2) again = true;
      else this.advance(steps);
    }
    return { ok: true };
  }

  draw(playerId) {
    if (this.finished) return { ok: false, error: '게임이 끝났습니다.' };
    const p = this.cur();
    if (p.id !== playerId) return { ok: false, error: '내 차례가 아닙니다.' };
    const n = this.penalty > 0 ? this.penalty : 1;
    const got = this.drawCards(p, n);
    this.addLog(this.penalty > 0 ? `${p.name}: 공격을 받아 ${got}장 먹음` : `${p.name}: 1장 뽑음`);
    if (this.penalty > 0) {
      this.penalty = 0;
      if (isJoker(this.top())) this.activeSuit = null;
    }
    // 더 뽑을 카드가 없는데 모두가 낼 카드도 없으면 판정승으로 끝낸다
    this.stall = got < n ? (this.stall || 0) + 1 : 0;
    if (!this.finished && this.stall >= this.alive().length) this.endByCount('더 이상 뽑을 카드가 없어요.');
    this.tick();
    if (!this.finished) this.advance(1);
    return { ok: true };
  }

  // 원카드 버튼: 본인이 누르면 안전, 남이 먼저 누르면 벌칙 1장
  callOneCard(callerId) {
    if (!this.oneCard || this.finished) return { ok: false, error: '지금은 외칠 수 없습니다.' };
    const target = this.find(this.oneCard.playerId);
    const caller = this.find(callerId);
    if (!target || !caller) return { ok: false };
    this.oneCard = null;
    if (caller.id === target.id) {
      this.addLog(`📢 ${target.name}: 원카드!`);
    } else {
      this.addLog(`🚨 ${caller.name}님이 먼저 외쳤다! ${target.name}님 1장 벌칙`);
      this.drawCards(target, 1);
      if (target.out && !this.finished && this.cur().id === target.id) this.advance(1);
    }
    return { ok: true };
  }

  removePlayer(playerId) {
    const p = this.find(playerId);
    if (!p || p.out) return;
    const wasTurn = this.cur().id === p.id;
    p.out = true;
    this.discard.splice(0, 0, ...p.hand);
    p.hand = [];
    this.addLog(`${p.name}님이 나갔습니다.`);
    if (this.oneCard && this.oneCard.playerId === p.id) this.oneCard = null;
    this.checkEnd();
    if (!this.finished && wasTurn) {
      this.advance(1); // 쌓인 공격은 다음 사람에게 넘어감
    }
  }

  // 각 플레이어 시점의 상태
  view(forId) {
    const me = this.find(forId);
    return {
      players: this.players.map((p) => ({
        id: p.id, name: p.name, bot: !!p.bot, count: p.hand.length,
        out: p.out, rank: p.rank, bankrupt: p.bankrupt,
      })),
      hand: me ? sortHand(me.hand) : [],
      playable: me && this.cur().id === me.id && !this.finished ? me.hand.filter((c) => this.canPlay(c)).map((c) => c.id) : [],
      top: this.top(),
      activeSuit: this.activeSuit,
      penalty: this.penalty,
      dir: this.dir,
      turn: this.cur().id,
      deckCount: this.deck.length,
      oneCard: this.oneCard ? this.oneCard.playerId : null,
      finished: this.finished,
      log: this.log.slice(-12),
      logSeq: this.logSeq,
    };
  }

  // --- 봇 ---
  botMove(botId) {
    const p = this.find(botId);
    const playable = p.hand.filter((c) => this.canPlay(c));
    if (playable.length === 0) return this.draw(botId);
    // 우선순위: 방어/공격 > 일반 > 조커(아껴둠)
    const score = (c) => {
      if (isJoker(c)) return this.penalty > 0 ? 50 : 5;
      if (attackValue(c) > 0) return 40;
      if (['J', 'Q', 'K'].includes(c.rank)) return 30;
      if (c.rank === '7') return 10;
      return 20;
    };
    playable.sort((a, b) => score(b) - score(a));
    const card = playable[0];
    let suit;
    if (card.rank === '7') {
      const counts = {};
      for (const c of p.hand) if (c.id !== card.id && SUITS.includes(c.suit)) counts[c.suit] = (counts[c.suit] || 0) + 1;
      suit = SUITS.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
    }
    return this.play(botId, card.id, suit);
  }
}

const SUIT_NAME = { S: '♠ 스페이드', H: '♥ 하트', D: '♦ 다이아', C: '♣ 클로버' };
const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };

function cardLabel(c) {
  if (c.suit === 'BJ') return '흑백 조커';
  if (c.suit === 'CJ') return '컬러 조커';
  return SUIT_SYM[c.suit] + c.rank;
}

function sortHand(hand) {
  const so = { S: 0, H: 1, D: 2, C: 3, BJ: 4, CJ: 5 };
  return hand.slice().sort((a, b) => so[a.suit] - so[b.suit] || RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
}

module.exports = { Game, makeDeck, attackValue, SUITS };
