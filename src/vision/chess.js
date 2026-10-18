// 棋规先验、方向判断与 FEN 摆放串。全部按"显示顺序"工作：下标 0 = 图上左上角格。

export const CLASSES = ['', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
const IDX = Object.fromEntries(CLASSES.map((c, i) => [c, i]));

function argmax(p, o, K) {
	let b = 0;
	for (let k = 1; k < K; k++) if (p[o + k] > p[o + b]) b = k;
	return b;
}

// probs: Float32Array(64·13)。返回 { squares, confidence }，并施加不依赖棋盘方向的先验：
// · 兵不可能在显示的第一/最后一行（无论正反都是第 1/8 横线）
// · 每方至多一个王、至多八个兵；多出来的保留最有把握的那个，其余改判为次优类别
export function applyPriors(probs) {
	const K = CLASSES.length;
	const p = Float32Array.from(probs);
	for (let i = 0; i < 64; i++) {
		const r = i >> 3;
		if (r === 0 || r === 7) { p[i * K + IDX.P] = 0; p[i * K + IDX.p] = 0; }
	}
	const cls = new Int32Array(64);
	for (let i = 0; i < 64; i++) cls[i] = argmax(p, i * K, K);
	const limits = [[IDX.K, 1], [IDX.k, 1], [IDX.P, 8], [IDX.p, 8]];
	for (let iter = 0; iter < 8; iter++) {
		let changed = false;
		for (const [c, max] of limits) {
			const hits = [];
			for (let i = 0; i < 64; i++) if (cls[i] === c) hits.push(i);
			if (hits.length <= max) continue;
			hits.sort((a, b) => p[b * K + c] - p[a * K + c]);
			for (const i of hits.slice(max)) {
				p[i * K + c] = 0;
				cls[i] = argmax(p, i * K, K);
				changed = true;
			}
		}
		if (!changed) break;
	}
	const squares = new Array(64), confidence = new Float32Array(64);
	for (let i = 0; i < 64; i++) {
		let s = 0;
		for (let k = 0; k < K; k++) s += p[i * K + k];
		squares[i] = CLASSES[cls[i]];
		confidence[i] = s > 0 ? p[i * K + cls[i]] / s : 0;
	}
	return { squares, confidence };
}

// 是否从黑方视角显示（黑子在下）。打分 > 0 表示白方在下：
// 王的位置权重最大，其次是兵的位置和"对头兵"（同一列白兵在黑兵下方），其余子力给个弱权重。
export function guessFlipped(squares) {
	let s = 0;
	const wp = new Array(8).fill(null).map(() => []), bp = new Array(8).fill(null).map(() => []);
	for (let i = 0; i < 64; i++) {
		const v = squares[i];
		if (!v) continue;
		const r = i >> 3, c = i & 7, d = r - 3.5;
		const white = v === v.toUpperCase();
		const sign = white ? 1 : -1;
		if (v === 'K' || v === 'k') s += 2 * sign * d;
		else if (v === 'P' || v === 'p') {
			s += 0.6 * sign * d;
			(white ? wp : bp)[c].push(r);
		} else s += 0.25 * sign * d;
	}
	for (let c = 0; c < 8; c++) {
		for (const rw of wp[c]) for (const rb of bp[c]) s += rw > rb ? 1 : -1;
	}
	return s < 0;
}

export function toPlacement(squares, flipped) {
	const sq = flipped ? squares.slice().reverse() : squares;
	const rows = [];
	for (let r = 0; r < 8; r++) {
		let row = '', empty = 0;
		for (let c = 0; c < 8; c++) {
			const v = sq[r * 8 + c];
			if (v) {
				if (empty) { row += empty; empty = 0; }
				row += v;
			} else empty++;
		}
		rows.push(row + (empty ? empty : ''));
	}
	return rows.join('/');
}
