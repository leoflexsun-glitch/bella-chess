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
