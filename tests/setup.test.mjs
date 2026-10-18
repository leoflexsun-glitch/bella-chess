import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, fenSyntaxError, possibleCastling } from '../src/chess/setup.js';
import { fromFen } from '../src/chess/engine.js';
import { balance } from '../src/chess/material.js';

test('初始局面合法，FEN 原样保留', () => {
	const r = prepare('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
	assert.deepEqual(r.errors, []);
	assert.equal(r.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
});

test('只有摆法的 FEN 自动补全为白先、无易位权', () => {
	const r = prepare('4k3/8/8/8/8/8/8/4K3');
	assert.deepEqual(r.errors, []);
	assert.equal(r.fen, '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
});

test('语法错误给出中文定位', () => {
	assert.match(fenSyntaxError('8/8/8'), /8 行/);
	assert.match(fenSyntaxError('rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'), /第 7 行应有 8 格/);
	assert.match(fenSyntaxError('rnbqkxnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'), /非法字符/);
	assert.match(fenSyntaxError('4k3/8/8/8/8/8/8/4K3 x'), /行棋方/);
});

test('缺王、多王、底线兵、兵过多都被拦下', () => {
	assert.ok(prepare('8/8/8/8/8/8/8/4K3 w - - 0 1').errors.some(e => /黑方缺少王/.test(e)));
	assert.ok(prepare('4k3/8/8/8/8/8/8/3KK3 w - - 0 1').errors.some(e => /2 个王/.test(e)));
	assert.ok(prepare('4k2P/8/8/8/8/8/8/4K3 w - - 0 1').errors.some(e => /h8 上有兵/.test(e)));
	assert.ok(prepare('4k3/8/8/8/8/8/PPPPPPPP/P3K3 w - - 0 1').errors.some(e => /兵|第 1/.test(e)));
	assert.ok(prepare('4k3/8/8/8/8/1P6/PPPPPPPP/4K3 w - - 0 1').errors.some(e => /9 个兵/.test(e)));
});

test('升变棋子数量受剩余兵数限制', () => {
	// 8 兵 + 2 后：不可能
	assert.ok(prepare('4k3/8/8/8/8/8/PPPPPPPP/QQ2K3 w - - 0 1').errors.some(e => /升变/.test(e)));
	// 7 兵 + 2 后：可能
	assert.deepEqual(prepare('4k3/8/8/8/8/8/PPPPPPP1/QQ2K3 w - - 0 1').errors, []);
});

test('不行棋一方被将军是不可能局面', () => {
	// 黑王被白车将军，却轮到白走
	assert.ok(prepare('4k3/8/8/8/8/8/8/4R1K1 w - - 0 1').errors.some(e => /正被将军/.test(e)));
	assert.deepEqual(prepare('4k3/8/8/8/8/8/8/4R1K1 b - - 0 1').errors, []);
});

test('已将杀/逼和的局面不能开局', () => {
	// 傻瓜杀之后
	assert.ok(prepare('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3').errors.some(e => /将杀/.test(e)));
	assert.ok(prepare('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').errors.some(e => /逼和/.test(e)));
});

test('易位权按王车是否在原位修正', () => {
	const pos = fromFen('r3k3/8/8/8/8/8/8/4K2R w KQkq - 0 1');
	assert.deepEqual(possibleCastling(pos), { K: true, Q: false, k: false, q: true });
	assert.equal(prepare('r3k3/8/8/8/8/8/8/4K2R w KQkq - 0 1').fen, 'r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1');
});

test('无效的过路兵格被清除，有效的保留', () => {
	assert.equal(prepare('4k3/8/8/8/8/8/8/4K3 w - e6 0 1').fen, '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
	assert.equal(prepare('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1').fen, '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
});

test('子力对比按棋盘计算', () => {
	const b = balance(fromFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'));
	assert.equal(b[8].score, 5);
	assert.deepEqual(b[8].extra, [4]);
	assert.equal(b[16].score, -5);
});
