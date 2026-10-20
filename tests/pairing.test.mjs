// 局面过渡的棋子配对：滑动的应是"真正走过的那颗"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairPieces } from '../src/view2d/pairing.js';

const SQ = name => (name.charCodeAt(0) - 97) + (Number(name[1]) - 1) * 16;
const pcs = list => list.map(([sq, code]) => ({ sq: SQ(sq), code }));
const names = sqs => sqs.map(s => String.fromCharCode(97 + (s & 15)) + ((s >> 4) + 1));

test('撤回 2.exd5 c6：c6 的兵退回 c7，d5 的黑兵淡入，白兵退回 e4', () => {
	const r = pairPieces(pcs([['d5', 'wP'], ['c6', 'bP']]), pcs([['e4', 'wP'], ['d5', 'bP'], ['c7', 'bP']]));
	assert.deepEqual(r.moves.map(names), [['c6', 'c7'], ['d5', 'e4']]);
	assert.deepEqual(names(r.appear), ['d5']);
	assert.deepEqual(names(r.vanish), []);
});

test('只配同种棋子；多出的淡出、缺的淡入', () => {
	const r = pairPieces(pcs([['f3', 'wN'], ['h7', 'bQ']]), pcs([['g1', 'wN'], ['d8', 'bR']]));
	assert.deepEqual(r.moves.map(names), [['f3', 'g1']]);
	assert.deepEqual(names(r.appear), ['d8']);
	assert.deepEqual(names(r.vanish), ['h7']);
});

test('两颗同种棋子各回各的最近格', () => {
	const r = pairPieces(pcs([['c3', 'wN'], ['f3', 'wN']]), pcs([['b1', 'wN'], ['g1', 'wN']]));
	assert.deepEqual(r.moves.map(names).sort(), [['c3', 'b1'], ['f3', 'g1']]);
});
