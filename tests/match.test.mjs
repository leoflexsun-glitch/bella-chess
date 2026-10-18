// 对局流程（不起真 worker）：从任意局面开局、记谱编号、PGN 头、悔棋。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, BLACK, parseSquare, toFen } from '../src/chess/engine.js';

const posted = [];
globalThis.Worker = class { constructor() { this.onmessage = null; } postMessage(msg) { posted.push(msg); } terminate() {} };
const { createMatch } = await import('../src/game/match.js');

beforeEach(() => { posted.length = 0; });

test('黑先局面、人执白：开局即让电脑先想', () => {
	const m = createMatch();
	m.newGame({ human: WHITE, fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40' });
	assert.equal(m.state.pos.turn, BLACK);
	assert.equal(posted.length, 1);
	assert.equal(posted[0].fen, '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40');
});

test('白先局面、人执白：等人走', () => {
	const m = createMatch();
	m.newGame({ human: WHITE, fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1' });
	assert.equal(posted.length, 0);
	assert.ok(m.play(parseSquare('e2'), parseSquare('e4')));
	assert.equal(m.state.history[0].no, 1);
});

test('自定义局面的 PGN 带 SetUp/FEN 头，黑先从 N... 开始编号', () => {
	const m = createMatch();
	const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40';
	m.newGame({ human: BLACK, fen });
	m.play(parseSquare('e8'), parseSquare('d7'));
	assert.equal(m.pgn(), `[SetUp "1"]\n[FEN "${fen}"]\n\n40... Kd7 *`);
});

test('标准开局 PGN 不带头', () => {
	const m = createMatch();
	m.newGame({ human: WHITE });
	m.play(parseSquare('e2'), parseSquare('e4'));
	assert.equal(m.pgn(), '1. e4 *');
});

test('悔棋回到自定义起始局面', () => {
	const m = createMatch();
	const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
	m.newGame({ human: WHITE, fen });
	m.play(parseSquare('e2'), parseSquare('e4'));
	assert.ok(m.undo());
	assert.equal(toFen(m.state.pos), fen);
	assert.equal(m.state.history.length, 0);
});

test('连续悔棋每次都停在轮到人走的局面（旧版会卡在轮到电脑却不思考）', () => {
	const m = createMatch();
	m.newGame({ human: WHITE });
	const seq = [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6']];
	// 用 restore 模拟人机交替走完四步（人执白，黑方着法由"电脑"走）
	m.restore({ human: WHITE, moves: seq.map(([a, b]) => a + b) });
	assert.equal(m.state.history.length, 4);
	assert.ok(m.undo(1));
	assert.equal(m.state.history.length, 2);
	assert.equal(m.state.pos.turn, WHITE);
	assert.ok(m.undo(1));
	assert.equal(m.state.history.length, 0);
	assert.equal(m.undo(1), false, '没有人类着法可悔时返回 false');
});

test('一次退多步', () => {
	const m = createMatch();
	m.restore({ human: WHITE, moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'] });
	assert.ok(m.undo(2));
	assert.equal(m.state.history.length, 2);
	assert.equal(m.state.pos.turn, WHITE);
});

test('恢复存档：重放着法，遇到非法着法即停', () => {
	const m = createMatch();
	m.restore({ human: BLACK, level: 'expert', moves: ['e2e4', 'e7e5', 'zz99', 'g1f3'] });
	assert.equal(m.state.history.length, 2);
	assert.equal(m.state.level, 'expert');
	assert.deepEqual(m.moves(), ['e2e4', 'e7e5']);
	// 人执黑、轮到白（电脑）：恢复后立即思考
	assert.equal(posted.length, 1);
});

test('恢复带升变的着法', () => {
	const m = createMatch();
	m.restore({ human: WHITE, fen: '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', moves: ['b7b8n'] });
	assert.equal(m.state.history[0].san, 'b8=N');
	assert.deepEqual(m.moves(), ['b7b8n']);
});

test('复盘取第 N 步后的局面', () => {
	const m = createMatch();
	m.restore({ human: WHITE, moves: ['e2e4', 'e7e5'] });
	assert.equal(m.fenAfter(-1), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
	assert.equal(m.fenAfter(0), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
	assert.equal(m.fenAfter(1), toFen(m.state.pos));
});

test('终局后认输无效，悔棋可以接着下', () => {
	const m = createMatch();
	// 傻瓜杀：人执黑
	m.restore({ human: BLACK, moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] });
	assert.equal(m.state.over.reason, 'checkmate');
	assert.equal(m.state.over.winner, BLACK);
	m.resign();
	assert.equal(m.state.over.reason, 'checkmate');
	assert.ok(m.undo());
	assert.equal(m.state.over, null);
	assert.equal(m.state.history.length, 3);
});
