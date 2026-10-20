// 局面过渡的棋子配对：滑动的应是"真正走过的那颗"，且同种棋子总移动距离最小。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairPieces } from '../src/view2d/pairing.js';
import { parseSquare, squareName } from '../src/chess/engine.js';

const pcs = list => list.map(([sq, code]) => ({ sq: parseSquare(sq), code }));
const names = sqs => sqs.map(squareName);
const sorted = moves => moves.map(names).sort();
const dist = (a, b) => Math.abs((a & 15) - (b & 15)) + Math.abs((a >> 4) - (b >> 4));

test('撤回 2.exd5 c6：c6 的兵退回 c7，d5 的黑兵淡入，白兵退回 e4', () => {
	const r = pairPieces(pcs([['d5', 'wP'], ['c6', 'bP']]), pcs([['e4', 'wP'], ['d5', 'bP'], ['c7', 'bP']]));
	assert.deepEqual(sorted(r.moves), [['c6', 'c7'], ['d5', 'e4']]);
	assert.deepEqual(names(r.appear), ['d5']);
	assert.deepEqual(names(r.vanish), []);
});

test('只配同种棋子；多出的淡出、缺的淡入', () => {
	const r = pairPieces(pcs([['f3', 'wN'], ['h7', 'bQ']]), pcs([['g1', 'wN'], ['d8', 'bR']]));
	assert.deepEqual(sorted(r.moves), [['f3', 'g1']]);
	assert.deepEqual(names(r.appear), ['d8']);
	assert.deepEqual(names(r.vanish), ['h7']);
});

test('两颗同种棋子各回各的最近格', () => {
	const r = pairPieces(pcs([['c3', 'wN'], ['f3', 'wN']]), pcs([['b1', 'wN'], ['g1', 'wN']]));
	assert.deepEqual(sorted(r.moves), [['c3', 'b1'], ['f3', 'g1']]);
});

// 暴力穷举：small 中每个配 large 中不同的一个，最小总距离
function bruteMin(small, large) {
	let best = Infinity;
	const go = (i, used, total) => {
		if (total >= best) return;
		if (i === small.length) { best = total; return; }
		for (let j = 0; j < large.length; j++) if (!(used & (1 << j))) go(i + 1, used | (1 << j), total + dist(small[i], large[j]));
	};
	go(0, 0, 0);
	return best;
}

test('总移动距离是最小的（与穷举比对 300 组随机局面）', () => {
	let seed = 7;
	const rand = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) % n; };   // 取高位：低位周期太短
	const squares = k => { const s = new Set(); while (s.size < k) s.add(rand(8) * 16 + rand(8)); return [...s]; };
	for (let round = 0; round < 300; round++) {
		const all = squares(rand(5) + rand(5) + 2), h = rand(all.length - 1) + 1;
		const have = all.slice(0, h), need = all.slice(h);
		const r = pairPieces(have.map(sq => ({ sq, code: 'wP' })), need.map(sq => ({ sq, code: 'wP' })));
		const total = r.moves.reduce((t, [a, b]) => t + dist(a, b), 0);
		const expect = have.length <= need.length ? bruteMin(have, need) : bruteMin(need, have);
		assert.equal(total, expect, `第 ${round} 组：${names(have)} → ${names(need)}`);
		assert.equal(r.moves.length, Math.min(have.length, need.length));
	}
});

test('同种棋子数量异常（损坏的存档）时退回就近配对，不卡住', () => {
	const sqs = [];
	for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) sqs.push(r * 16 + f);
	const t = Date.now();
	// 每边 30 颗：按子集动态规划要 2³⁰ 个状态（分配不出来）；应退回就近配对
	const r = pairPieces(sqs.slice(0, 30).map(sq => ({ sq, code: 'wN' })), sqs.slice(30, 60).map(sq => ({ sq, code: 'wN' })));
	assert.equal(r.moves.length, 30);
	assert.ok(Date.now() - t < 500, '应很快返回');
});
