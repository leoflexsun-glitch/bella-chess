// 局面平滑过渡（悔棋、复盘）时给棋子配对：哪个旧棋子滑到哪个新格。
// have：原位对不上的旧棋子；need：还没有棋子的新格；元素都是 { sq, code }（0x88 格号、棋子代码）。
// 同种棋子之间求总曼哈顿距离最小的配对（复盘一下跳好几步时，不会让一颗棋子横穿全盘、另一颗只挪一格）。
// 多出的旧棋子淡出，缺的新格淡入。
// 按子集做动态规划：合法对局里同种棋子最多 10 颗（升变），只遍历可达状态，约 10 × 2¹⁰ 次运算；
// 更多（只可能来自损坏的存档）就退回逐个就近配对，免得卡住页面。

import { fileOf, rankOf } from '../chess/engine.js';

const dist = (a, b) => Math.abs(fileOf(a) - fileOf(b)) + Math.abs(rankOf(a) - rankOf(b));

const MAX_EXACT = 10;

// 逐个就近：按距离从小到大取未用过的配对（数量异常时的退路）。
function greedy(small, large) {
	const all = [];
	small.forEach((a, i) => large.forEach((b, j) => all.push([dist(a.sq, b.sq), i, j])));
	all.sort((x, y) => x[0] - y[0]);
	const usedI = new Set(), usedJ = new Set(), pairs = [];
	for (const [, i, j] of all) {
		if (usedI.has(i) || usedJ.has(j)) continue;
		usedI.add(i);
		usedJ.add(j);
		pairs.push([i, j]);
	}
	return pairs;
}

// 从 small 里每个元素各配 large 中不同的一个，总距离最小；返回 [i, j] 对（small 下标、large 下标）。
function assign(small, large) {
	if (large.length > MAX_EXACT) return greedy(small, large);
	const n = small.length, full = 1 << large.length;
	// cost[i][mask]：small 的前 i 个已配到 mask 里那些 large 元素时的最小总距离
	const cost = Array.from({ length: n + 1 }, () => new Float64Array(full).fill(Infinity));
	const pick = Array.from({ length: n + 1 }, () => new Int8Array(full).fill(-1));
	cost[0][0] = 0;
	for (let i = 0; i < n; i++) {
		for (let mask = 0; mask < full; mask++) {
			if (cost[i][mask] === Infinity) continue;
			for (let j = 0; j < large.length; j++) {
				if (mask & (1 << j)) continue;
				const next = mask | (1 << j), c = cost[i][mask] + dist(small[i].sq, large[j].sq);
				if (c < cost[i + 1][next]) { cost[i + 1][next] = c; pick[i + 1][next] = j; }
			}
		}
	}
	let best = -1;
	for (let mask = 0; mask < full; mask++) if (cost[n][mask] < (best < 0 ? Infinity : cost[n][best])) best = mask;
	const pairs = [];
	for (let i = n, mask = best; i > 0; i--) {
		const j = pick[i][mask];
		pairs.push([i - 1, j]);
		mask &= ~(1 << j);
	}
	return pairs;
}

export function pairPieces(have, need) {
	const moves = [], used = new Set(), filled = new Set();
	for (const code of new Set(have.map(p => p.code))) {
		const from = have.filter(p => p.code === code), to = need.filter(p => p.code === code);
		if (!to.length) continue;
		const swap = from.length > to.length;               // 让较少的一边去配较多的一边
		for (const [i, j] of assign(swap ? to : from, swap ? from : to)) {
			const a = swap ? from[j] : from[i], b = swap ? to[i] : to[j];
			moves.push([a.sq, b.sq]);
			used.add(a.sq);
			filled.add(b.sq);
		}
	}
	return {
		moves,                                                    // [[from, to]]：滑过去
		appear: need.filter(b => !filled.has(b.sq)).map(b => b.sq), // 淡入
		vanish: have.filter(a => !used.has(a.sq)).map(a => a.sq)    // 淡出
	};
}
