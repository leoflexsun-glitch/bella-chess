// 灰度转换与单应性重采样。训练脚本 tools/vision/vlib.py 里有逐行对应的 numpy 实现，
// 两边任何一处改动都要同步，否则模型看到的输入分布会和训练时不一致。

// 灰度（BT.601 亮度），只转 [x0,x1)×[y0,y1) 这块区域，省掉大图上无关的像素。
export function toGray(img, x0 = 0, y0 = 0, x1 = img.width, y1 = img.height) {
	x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
	x1 = Math.min(img.width, Math.ceil(x1)); y1 = Math.min(img.height, Math.ceil(y1));
	const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
	const out = new Float32Array(w * h);
	const d = img.data, W = img.width;
	for (let y = 0; y < h; y++) {
		let s = ((y + y0) * W + x0) * 4, o = y * w;
		for (let x = 0; x < w; x++, s += 4) out[o + x] = 0.299 * d[s] + 0.587 * d[s + 1] + 0.114 * d[s + 2];
	}
	return { w, h, x0, y0, data: out };
}

// 单位正方形 (0,0)(1,0)(1,1)(0,1) → 四角 TL,TR,BR,BL 的单应矩阵（Heckbert 闭式解）。
// 返回 [a,b,c,d,e,f,g,h]：x=(a u+b v+c)/(g u+h v+1)，y=(d u+e v+f)/(g u+h v+1)
export function squareToQuad(corners) {
	const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = corners;
	const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
	if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
		return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0];
	}
	const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
	const den = dx1 * dy2 - dx2 * dy1;
	const g = (dx3 * dy2 - dx2 * dy3) / den;
	const h = (dx1 * dy3 - dx3 * dy1) / den;
	return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

export function applyH(H, u, v) {
	const z = H[6] * u + H[7] * v + 1;
	return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z];
}

// 每个输出像素的超采样边长：源图里一个输出像素覆盖几像素就采几×几，等效面积平均，防混叠
export function superSamples(corners, n) {
	let side = 0;
	for (let i = 0; i < 4; i++) {
		const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) & 3];
		side = Math.max(side, Math.hypot(bx - ax, by - ay));
	}
	return Math.max(1, Math.min(8, Math.ceil(side / n - 1e-6)));
}

// 把四角围成的棋盘重采样成 n×n 灰度图（像素中心约定：像素 i 覆盖 [i,i+1)）。
export function warpGray(img, corners, n) {
	let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
	for (const [x, y] of corners) {
		bx0 = Math.min(bx0, x); by0 = Math.min(by0, y);
		bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
	}
	const g = toGray(img, bx0 - 2, by0 - 2, bx1 + 2, by1 + 2);
	return warpFromGray(g, corners, n);
}

export function warpFromGray(g, corners, n) {
	const H = squareToQuad(corners.map(([x, y]) => [x - g.x0, y - g.y0]));
	const k = superSamples(corners, n);
	const out = new Float32Array(n * n);
	const src = g.data, w = g.w, h = g.h;
	if (!w || !h) return out;
	const inv = 1 / (k * k), step = 1 / (n * k);
	const [a, b, c, d, e, f, gg, hh] = H;
	for (let v = 0; v < n; v++) {
		for (let u = 0; u < n; u++) {
			let acc = 0;
			for (let sy = 0; sy < k; sy++) {
				const bv = (v * k + sy + 0.5) * step;
				for (let sx = 0; sx < k; sx++) {
					const bu = (u * k + sx + 0.5) * step;
					const z = gg * bu + hh * bv + 1;
					const fx = (a * bu + b * bv + c) / z - 0.5;
					const fy = (d * bu + e * bv + f) / z - 0.5;
					let ix = Math.floor(fx), iy = Math.floor(fy);
					const wx = fx - ix, wy = fy - iy;
					let ix1 = ix + 1, iy1 = iy + 1;
					if (ix < 0) ix = 0; else if (ix > w - 1) ix = w - 1;
					if (ix1 < 0) ix1 = 0; else if (ix1 > w - 1) ix1 = w - 1;
					if (iy < 0) iy = 0; else if (iy > h - 1) iy = h - 1;
					if (iy1 < 0) iy1 = 0; else if (iy1 > h - 1) iy1 = h - 1;
					const r0 = iy * w, r1 = iy1 * w;
					const top = src[r0 + ix] + (src[r0 + ix1] - src[r0 + ix]) * wx;
					const bot = src[r1 + ix] + (src[r1 + ix1] - src[r1 + ix]) * wx;
					acc += top + (bot - top) * wy;
				}
			}
			out[v * n + u] = acc * inv;
		}
	}
	return out;
}

// 整盘归一化（零均值、单位方差），去掉亮度/对比度差异；eps 防止近乎纯色的图被放大成噪声
export function normalizeBoard(board) {
	let s = 0, s2 = 0;
	const n = board.length;
	for (let i = 0; i < n; i++) { s += board[i]; s2 += board[i] * board[i]; }
	const mean = s / n;
	const std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
	const inv = 1 / (std + 8);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = (board[i] - mean) * inv;
	return out;
}

// n×n 整盘 → 64 块 t×t 的格子（显示顺序，左上起逐行）
export function cutTiles(board, n) {
	const t = n / 8;
	const tiles = new Float32Array(64 * t * t);
	for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
		const base = (r * 8 + c) * t * t;
		for (let y = 0; y < t; y++) {
			const row = (r * t + y) * n + c * t;
			for (let x = 0; x < t; x++) tiles[base + y * t + x] = board[row + x];
		}
	}
	return tiles;
}
