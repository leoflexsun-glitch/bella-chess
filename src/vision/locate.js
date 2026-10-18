// 棋盘定位：找 7×7 个内部"X 形角点"（四个相邻格两亮两暗的交点）组成的格点阵。
// 只认 X 角点而不认直线，是因为网页 UI 里到处是直线和文字，但交替明暗的十字交点几乎只有棋盘才有；
// 坐标字母、高亮、边框都落在格子内部或外边缘，不会破坏内部角点。

import { toGray } from './warp.js';

let DEBUG = null;          // 调试用：locateBoard(img, [])会把各层假设与验证结果写进这个数组
const R_LEVEL = 3;          // 金字塔各层统一用的象限半径（像素）
const S_MIN = 7, S_MAX = 30; // 各层上接受的格宽范围；相邻层有重叠

// 2×2 盒式降采样
function down2(g) {
	const w = g.w >> 1, h = g.h >> 1, out = new Float32Array(w * h), W = g.w, d = g.data;
	for (let y = 0; y < h; y++) {
		const r0 = 2 * y * W, r1 = r0 + W;
		for (let x = 0; x < w; x++) {
			const i = 2 * x;
			out[y * w + x] = 0.25 * (d[r0 + i] + d[r0 + i + 1] + d[r1 + i] + d[r1 + i + 1]);
		}
	}
	return { w, h, data: out };
}

// 积分图 (w+1)×(h+1)，Float64 防止大图累加误差
function integral(g) {
	const W = g.w + 1, ii = new Float64Array(W * (g.h + 1)), d = g.data;
	for (let y = 0; y < g.h; y++) {
		let row = 0;
		const o = (y + 1) * W, p = y * W, s = y * g.w;
		for (let x = 0; x < g.w; x++) {
			row += d[s + x];
			ii[o + x + 1] = ii[p + x + 1] + row;
		}
	}
	return { ii, W, w: g.w, h: g.h };
}

// 角点 (x,y)（像素角坐标）处的 X 响应：四象限均值 TL,TR,BL,BR。
// R = TL+BR-TR-BL 衡量"对角同色"，再减去两条对角线内部的不平衡，
// 这样单个亮块的 L 形角、普通边缘都≈0，只有真正的棋盘交点得高分。返回带符号的分数。
function xscore(I, x, y, r) {
	if (x - r < 0 || y - r < 0 || x + r > I.w || y + r > I.h) return 0;
	const { ii, W } = I;
	const a = (y - r) * W, b = y * W, c = (y + r) * W;
	const tl = ii[b + x] - ii[a + x] - ii[b + x - r] + ii[a + x - r];
	const tr = ii[b + x + r] - ii[a + x + r] - ii[b + x] + ii[a + x];
	const bl = ii[c + x] - ii[b + x] - ii[c + x - r] + ii[b + x - r];
	const br = ii[c + x + r] - ii[b + x + r] - ii[c + x] + ii[b + x];
	const R = tl + br - tr - bl;
	const s = (Math.abs(R) - Math.abs(tl - br) - Math.abs(tr - bl)) / (r * r);
	return s > 0 ? (R > 0 ? s : -s) : 0;
}

// 在一层上算 X 响应并做非极大抑制，返回候选点
function detect(I, r, thresh, maxN) {
	const { w, h } = I;
	const S = new Float32Array((w + 1) * (h + 1));
	const W1 = w + 1;
	for (let y = r; y <= h - r; y++) for (let x = r; x <= w - r; x++) S[y * W1 + x] = xscore(I, x, y, r);
	const pts = [];
	const nr = 2;
	for (let y = r; y <= h - r; y++) {
		for (let x = r; x <= w - r; x++) {
			const v = S[y * W1 + x], av = Math.abs(v);
			if (av < thresh) continue;
			let ok = true;
			for (let dy = -nr; dy <= nr && ok; dy++) {
				const yy = y + dy;
				if (yy < 0 || yy > h) continue;
				for (let dx = -nr; dx <= nr; dx++) {
					const xx = x + dx;
					if (xx < 0 || xx > w || (dx === 0 && dy === 0)) continue;
					const u = Math.abs(S[yy * W1 + xx]);
					if (u > av || (u === av && (dy < 0 || (dy === 0 && dx < 0)))) { ok = false; break; }
				}
			}
			if (ok) pts.push({ x, y, s: av, sg: v > 0 ? 1 : -1 });
		}
	}
	pts.sort((a, b) => b.s - a.s);
	if (pts.length > maxN) pts.length = maxN;
	return pts;
}

// 网格桶，便于查邻点
function bucketize(pts, cell) {
	const map = new Map();
	for (let i = 0; i < pts.length; i++) {
		const k = Math.floor(pts[i].x / cell) * 65536 + Math.floor(pts[i].y / cell);
		let a = map.get(k);
		if (!a) map.set(k, a = []);
		a.push(i);
	}
	return {
		near(x, y, rad, cb) {
			const x0 = Math.floor((x - rad) / cell), x1 = Math.floor((x + rad) / cell);
			const y0 = Math.floor((y - rad) / cell), y1 = Math.floor((y + rad) / cell);
			for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
				const a = map.get(gx * 65536 + gy);
				if (a) for (const i of a) cb(i);
			}
		}
	};
}

// 统计异号点对的位移向量（右向 / 下向锥内），格点阵的基向量会形成尖峰
function voteVectors(pts, B, horizontal) {
	const span = S_MAX + 1, off = Math.ceil(S_MAX * 0.35) + 1, hw = 2 * off + 1;
	const acc = new Float32Array(span * hw);
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i];
		B.near(p.x, p.y, S_MAX, j => {
			const q = pts[j];
			if (q.sg === p.sg) return;
			const along = horizontal ? q.x - p.x : q.y - p.y;
			const across = horizontal ? q.y - p.y : q.x - p.x;
			if (along < S_MIN || along > S_MAX || Math.abs(across) > 0.32 * along) return;
			const ratio = p.s > q.s ? q.s / p.s : p.s / q.s;
			if (ratio < 0.25) return;
			acc[along * hw + across + off] += Math.min(p.s, q.s);
		});
	}
	// 3×3 平滑后取前几个峰
	const sm = new Float32Array(acc.length);
	for (let a = 1; a < span - 1; a++) for (let c = 1; c < hw - 1; c++) {
		let s = 0;
		for (let da = -1; da <= 1; da++) for (let dc = -1; dc <= 1; dc++) s += acc[(a + da) * hw + c + dc];
		sm[a * hw + c] = s;
	}
	const peaks = [];
	for (let a = S_MIN; a < span - 1; a++) for (let c = 1; c < hw - 1; c++) {
		const v = sm[a * hw + c];
		if (v <= 0) continue;
		let ok = true;
		for (let da = -2; da <= 2 && ok; da++) for (let dc = -2; dc <= 2; dc++) {
			const aa = a + da, cc = c + dc;
			if (aa < 0 || aa >= span || cc < 0 || cc >= hw || (da === 0 && dc === 0)) continue;
			if (sm[aa * hw + cc] > v) { ok = false; break; }
		}
		if (!ok) continue;
		// 亚像素：加权质心
		let sw = 0, sa = 0, sc = 0;
		for (let da = -1; da <= 1; da++) for (let dc = -1; dc <= 1; dc++) {
			const u = acc[(a + da) * hw + c + dc];
			sw += u; sa += u * (a + da); sc += u * (c + dc - off);
		}
		const along = sa / sw, across = sc / sw;
		peaks.push({ v, x: horizontal ? along : across, y: horizontal ? across : along });
	}
	peaks.sort((p, q) => q.v - p.v);
	// 繁忙的界面（文字、图标）也会投出不少票，棋盘的基向量未必排第一，多留几个峰
	const top = peaks.filter(p => p.v >= 0.08 * peaks[0].v).slice(0, 5);
	// near(along, across)：在猜测向量附近（±20%）找累加器最大处，返回该处质心向量
	top.near = (ga, gc) => {
		const ra = Math.max(1, Math.round(ga * 0.2));
		let bv = 0, ba = 0, bc = 0;
		for (let a = Math.max(1, Math.round(ga) - ra); a <= Math.min(span - 2, Math.round(ga) + ra); a++) {
			for (let c = Math.max(1, Math.round(gc) + off - ra); c <= Math.min(hw - 2, Math.round(gc) + off + ra); c++) {
				if (sm[a * hw + c] > bv) { bv = sm[a * hw + c]; ba = a; bc = c; }
			}
		}
		if (!bv) return null;
		let sw = 0, sa = 0, sc = 0;
		for (let da = -1; da <= 1; da++) for (let dc = -1; dc <= 1; dc++) {
			const u = acc[(ba + da) * hw + bc + dc];
			sw += u; sa += u * (ba + da); sc += u * (bc + dc - off);
		}
		if (!sw) return null;
		const along = sa / sw, across = sc / sw;
		return { v: bv, x: horizontal ? along : across, y: horizontal ? across : along };
	};
	return top;
}

// 按两个基向量把候选点连成网格并给出整数坐标；返回各连通分量
function linkLattice(pts, B, vr, vd) {
	const n = pts.length;
	const right = new Int32Array(n).fill(-1), down = new Int32Array(n).fill(-1);
	const tolR = 0.24 * Math.hypot(vr.x, vr.y), tolD = 0.24 * Math.hypot(vd.x, vd.y);
	const best = (p, v, tol) => {
		let bi = -1, bd = tol;
		const tx = p.x + v.x, ty = p.y + v.y;
		B.near(tx, ty, tol, j => {
			const q = pts[j];
			if (q.sg === p.sg) return;
			const d = Math.hypot(q.x - tx, q.y - ty);
			if (d < bd) { bd = d; bi = j; }
		});
		return bi;
	};
	for (let i = 0; i < n; i++) { right[i] = best(pts[i], vr, tolR); down[i] = best(pts[i], vd, tolD); }
	// 反向邻接
	const left = new Int32Array(n).fill(-1), up = new Int32Array(n).fill(-1);
	for (let i = 0; i < n; i++) {
		if (right[i] >= 0 && left[right[i]] < 0) left[right[i]] = i;
		if (down[i] >= 0 && up[down[i]] < 0) up[down[i]] = i;
	}
	const gi = new Int32Array(n), gj = new Int32Array(n), comp = new Int32Array(n).fill(-1);
	const comps = [];
	for (let s = 0; s < n; s++) {
		if (comp[s] >= 0 || (right[s] < 0 && down[s] < 0 && left[s] < 0 && up[s] < 0)) continue;
		const id = comps.length, members = [s];
		comp[s] = id; gi[s] = 0; gj[s] = 0;
		const seen = new Map([[0, s]]);
		for (let k = 0; k < members.length; k++) {
			const p = members[k];
			const nb = [[right[p], 1, 0], [left[p], -1, 0], [down[p], 0, 1], [up[p], 0, -1]];
			for (const [q, di, dj] of nb) {
				if (q < 0 || comp[q] >= 0) continue;
				const ni = gi[p] + di, nj = gj[p] + dj, key = ni * 4096 + nj;
				if (seen.has(key)) continue; // 同一格位已被占：丢弃冲突点
				comp[q] = id; gi[q] = ni; gj[q] = nj; seen.set(key, q);
				members.push(q);
			}
		}
		if (members.length >= 6) comps.push(members.map(m => ({ i: gi[m], j: gj[m], x: pts[m].x, y: pts[m].y, s: pts[m].s, sg: pts[m].sg })));
	}
	return comps;
}

// 解 n×n 线性方程（高斯消元，部分选主元）
function solve(A, b, n) {
	for (let c = 0; c < n; c++) {
		let p = c;
		for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
		if (Math.abs(A[p * n + c]) < 1e-12) return null;
		if (p !== c) {
			for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
			const t = b[c]; b[c] = b[p]; b[p] = t;
		}
		for (let r = c + 1; r < n; r++) {
			const f = A[r * n + c] / A[c * n + c];
			if (!f) continue;
			for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
			b[r] -= f * b[c];
		}
	}
	const x = new Float64Array(n);
	for (let r = n - 1; r >= 0; r--) {
		let s = b[r];
		for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
		x[r] = s / A[r * n + r];
	}
	return x;
}

// 拟合格点坐标 (i,j) → 像素 (x,y)。affine=true 时只拟合仿射（点少或外推时更稳）
// 返回 [a,b,c,d,e,f,g,h]：x=(a i+b j+c)/(g i+h j+1)
function fitMap(P, affine) {
	if (affine) {
		const A = new Float64Array(9), bx = new Float64Array(3), by = new Float64Array(3);
		for (const p of P) {
			const v = [p.i, p.j, 1], w = p.w ?? 1;
			for (let r = 0; r < 3; r++) {
				for (let c = 0; c < 3; c++) A[r * 3 + c] += w * v[r] * v[c];
				bx[r] += w * v[r] * p.x; by[r] += w * v[r] * p.y;
			}
		}
		const sx = solve(A.slice(), bx, 3), sy = solve(A.slice(), by, 3);
		if (!sx || !sy) return null;
		return [sx[0], sx[1], sx[2], sy[0], sy[1], sy[2], 0, 0];
	}
	// DLT（h33=1）线性最小二乘；先把像素坐标平移缩放到原点附近，数值更稳
	let mx = 0, my = 0;
	for (const p of P) { mx += p.x; my += p.y; }
	mx /= P.length; my /= P.length;
	let sc = 0;
	for (const p of P) sc += Math.hypot(p.x - mx, p.y - my);
	sc = sc / P.length || 1;
	const A = new Float64Array(64), b = new Float64Array(8);
	for (const p of P) {
		const X = (p.x - mx) / sc, Y = (p.y - my) / sc, w = p.w ?? 1;
		const r1 = [p.i, p.j, 1, 0, 0, 0, -p.i * X, -p.j * X];
		const r2 = [0, 0, 0, p.i, p.j, 1, -p.i * Y, -p.j * Y];
		for (let r = 0; r < 8; r++) {
			for (let c = 0; c < 8; c++) A[r * 8 + c] += w * (r1[r] * r1[c] + r2[r] * r2[c]);
			b[r] += w * (r1[r] * X + r2[r] * Y);
		}
	}
	const h = solve(A, b, 8);
	if (!h) return null;
	// 反归一化：x = sc·X + mx
	const [a, bb, c, d, e, f, g, hh] = h;
	return [sc * a + mx * g, sc * bb + mx * hh, sc * c + mx, sc * d + my * g, sc * e + my * hh, sc * f + my, g, hh];
}

function mapPt(M, i, j) {
	const z = M[6] * i + M[7] * j + 1;
	return [(M[0] * i + M[1] * j + M[2]) / z, (M[3] * i + M[4] * j + M[5]) / z];
}

// 在全分辨率上把预测角点吸附到局部 X 响应最大处（含亚像素抛物线插值）
function refinePoint(I, x, y, r, rad, sign) {
	const cx = Math.round(x), cy = Math.round(y);
	let best = 0, bx = cx, by = cy;
	for (let yy = cy - rad; yy <= cy + rad; yy++) for (let xx = cx - rad; xx <= cx + rad; xx++) {
		const v = xscore(I, xx, yy, r) * sign;
		if (v > best) { best = v; bx = xx; by = yy; }
	}
	if (best <= 0) return null;
	const f = (xx, yy) => Math.max(0, xscore(I, xx, yy, r) * sign);
	const l = f(bx - 1, by), rr = f(bx + 1, by), u = f(bx, by - 1), d = f(bx, by + 1);
	let ox = 0, oy = 0;
	const dx = l - 2 * best + rr, dy = u - 2 * best + d;
	if (dx < 0) ox = Math.max(-0.5, Math.min(0.5, 0.5 * (l - rr) / dx));
	if (dy < 0) oy = Math.max(-0.5, Math.min(0.5, 0.5 * (u - d) / dy));
	return { x: bx + ox, y: by + oy, s: best };
}

// 由粗到细精修一个 7×7 假设：先在检测层上吸附，再逐层放大 2 倍、小范围再吸附，直到原图。
// 比直接在原图大范围搜索便宜得多，也不容易被细尺度的摩尔纹/纹理带偏。
// M 把内部角点 (0..6,0..6) 映到第 L 层像素；返回原图坐标下的稳健拟合结果。
function refineLattice(levels, L, M, sign00) {
	const c0 = mapPt(M, 0, 0), c1 = mapPt(M, 6, 6);
	let s = Math.max(3, Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) / (6 * Math.SQRT2));
	let pts = [];
	for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
		const [x, y] = mapPt(M, i, j);
		pts.push({ i, j, x, y, sg: ((i + j) & 1) ? -sign00 : sign00, s: 0 });
	}
	// 每层都拟合一次；最终取"仍有足够角点支撑"的最细一层——截图在原图层得到亚像素精度，
	// 而书籍斜线阴影、摩尔纹等细纹理会在原图层把角点带偏，这时退回粗一层的结果
	const fits = [];
	for (let l = L; l >= 0; l--) {
		const I = levels[l].I;
		const r = Math.max(2, Math.min(60, Math.round(s / 5)));
		const rad = l === L ? Math.max(2, Math.round(s * 0.15)) : 2;
		const next = [];
		for (const p of pts) {
			const q = refinePoint(I, p.x, p.y, r, rad, p.sg);
			if (q) next.push({ ...p, x: q.x, y: q.y, s: q.s });
		}
		pts = next;
		if (pts.length < 8) break;
		const f = 1 << l;
		const fit = fitBoard(pts.map(p => ({ ...p, x: p.x * f, y: p.y * f })), s * f);
		if (fit) fits.push(fit);
		if (DEBUG) DEBUG.push(`  level f=${f} r=${r} rad=${rad} refined=${pts.length} fit=${fit ? fit.n + '/' + fit.rms.toFixed(2) : '-'}`);
		if (l > 0) { for (const p of pts) { p.x *= 2; p.y *= 2; } s *= 2; }
	}
	if (!fits.length) return null;
	const maxN = Math.max(...fits.map(f => f.n));
	for (let k = fits.length - 1; k >= 0; k--) if (fits[k].n >= 0.9 * maxN) return fits[k];
	return fits[0];
}

// 原图上的稳健拟合：去掉弱响应和离群点，仿射为主，透视明显更好时才用透视
function fitBoard(found, s) {
	const ss = found.map(p => p.s).sort((a, b) => a - b);
	const med = ss[ss.length >> 1];
	let pts = found.filter(p => p.s > Math.max(6, 0.25 * med));
	if (pts.length < 8) return null;
	let fit = fitMap(pts, true);
	for (let it = 0; it < 3 && fit; it++) {
		const res = pts.map(p => { const [x, y] = mapPt(fit, p.i, p.j); return Math.hypot(x - p.x, y - p.y); });
		const keep = pts.filter((p, k) => res[k] < Math.max(1.0, 0.12 * s));
		if (keep.length < 8) return null;
		pts = keep;
		fit = (pts.length >= 20 && it > 0 && fitMap(pts, false)) || fitMap(pts, true);
	}
	if (!fit) return null;
	const rms = F => Math.sqrt(pts.reduce((a, p) => { const [x, y] = mapPt(F, p.i, p.j); return a + (x - p.x) ** 2 + (y - p.y) ** 2; }, 0) / pts.length);
	const fa = fitMap(pts, true);
	let F = fa, e = rms(fa);
	if (pts.length >= 20) {
		const fh = fitMap(pts, false);
		if (fh) { const eh = rms(fh); if (eh < e * 0.7 && e > 0.3) { F = fh; e = eh; } }
	}
	return { M: F, n: pts.length, rms: e, s };
}

// 一个连通分量 → 若干候选 7×7 窗口（棋盘恰好 49 个内部角点；比这大的分量多半粘上了纹理/摩尔纹，
// 比这小的说明有角点被遮挡，需要往外补）。按窗口内成员数排序，只留前几个。
function windowsOf(comp) {
	let imin = Infinity, imax = -Infinity, jmin = Infinity, jmax = -Infinity;
	for (const p of comp) { imin = Math.min(imin, p.i); imax = Math.max(imax, p.i); jmin = Math.min(jmin, p.j); jmax = Math.max(jmax, p.j); }
	const ia = imax - imin >= 6 ? [imin, imax - 6] : [imax - 6, imin];
	const ja = jmax - jmin >= 6 ? [jmin, jmax - 6] : [jmax - 6, jmin];
	const wins = [];
	for (let a = ia[0]; a <= ia[1]; a++) for (let b = ja[0]; b <= ja[1]; b++) {
		const mem = comp.filter(p => p.i >= a && p.i <= a + 6 && p.j >= b && p.j <= b + 6);
		if (mem.length >= 10) wins.push({ a, b, mem });
	}
	wins.sort((x, y) => y.mem.length - x.mem.length);
	const top = wins.length ? wins[0].mem.length : 0;
	// 分量本身不足 7×7 时所有窗口成员数相同，都要验证；否则只留成员数接近最多的几个
	return wins.filter(w => w.mem.length >= top * 0.8).slice(0, 25);
}

function windowModel(w) {
	const P = w.mem.map(p => ({ i: p.i - w.a, j: p.j - w.b, x: p.x, y: p.y }));
	const M = fitMap(P, true);
	let vote = 0;
	for (const p of w.mem) vote += ((p.i - w.a + p.j - w.b) & 1) ? -p.sg : p.sg;
	return M && { M, sign: vote >= 0 ? 1 : -1 };
}

export function locateBoard(img, debug = null) {
	if (!img || !img.width || !img.height) return null;
	DEBUG = debug;
	const g0 = toGray(img);
	// 金字塔：每层 2× 降采样，直到太小；每层都留积分图供检测与精修
	const levels = [{ g: g0, f: 1, I: integral(g0) }];
	while (Math.min(levels[levels.length - 1].g.w, levels[levels.length - 1].g.h) >= 2 * 8 * S_MIN + 8 && levels.length < 7) {
		const prev = levels[levels.length - 1];
		const g = down2(prev.g);
		levels.push({ g, f: prev.f * 2, I: integral(g) });
	}
	const cands = [];
	for (let li = 0; li < levels.length; li++) {
		const L = levels[li];
		// 大图的原分辨率层不做检测：≥160px 的棋盘在 2× 层上格宽仍 ≥10px，足够；原图只用于最后精修
		if (li === 0 && g0.w * g0.h > 1.5e6) continue;
		const pts = detect(L.I, R_LEVEL, 8, 6000);
		if (pts.length < 12) continue;
		const B = bucketize(pts, S_MAX);
		const hv = voteVectors(pts, B, true), vv = voteVectors(pts, B, false);
		// 候选基向量对：两向独立峰的组合 + 由一向的峰旋转 90°（格子是正方形）后在另一向就近取峰
		const pairs = [];
		for (const vr of hv) for (const vd of vv) pairs.push([vr, vd]);
		for (const vr of hv) { const vd = vv.near(vr.x, -vr.y); if (vd) pairs.push([vr, vd]); }
		for (const vd of vv) { const vr = hv.near(vd.y, -vd.x); if (vr) pairs.push([vr, vd]); }
		const done = [];
		for (const [vr, vd] of pairs) {
			if (done.some(([a, b]) => Math.hypot(a.x - vr.x, a.y - vr.y) < 0.5 && Math.hypot(b.x - vd.x, b.y - vd.y) < 0.5)) continue;
			done.push([vr, vd]);
			const lr = Math.hypot(vr.x, vr.y), ld = Math.hypot(vd.x, vd.y);
			if (lr / ld > 1.4 || ld / lr > 1.4) continue;
			if (Math.abs(vr.x * vd.x + vr.y * vd.y) > 0.35 * lr * ld) continue;
			const comps = linkLattice(pts, B, vr, vd);
			if (debug) debug.push(`L f=${L.f} pts=${pts.length} vr=(${vr.x.toFixed(1)},${vr.y.toFixed(1)}) vd=(${vd.x.toFixed(1)},${vd.y.toFixed(1)}) comps=${comps.map(c => c.length).sort((a, b) => b - a).slice(0, 4)}`);
			comps.sort((a, b) => b.length - a.length);
			for (const comp of comps.slice(0, 4)) {
				if (comp.length < 10) continue;
				// 分量远大于 49 个点说明粘连了摩尔纹/纹理，降低其窗口的优先级
				const pr = Math.max(0, comp.length - 56) * 0.05;
				for (const w of windowsOf(comp)) cands.push({ w, li, n: w.mem.length, pri: w.mem.length - pr });
			}
		}
	}
	if (!cands.length) return null;
	// 成员数多的窗口优先验证；同一位置的重复假设跳过
	cands.sort((a, b) => b.pri - a.pri);
	const results = [];
	const seen = [];
	let tried = 0;
	for (const c of cands) {
		if (tried >= 20) break;
		const wm = windowModel(c.w);
		if (!wm) continue;
		const f = levels[c.li].f;
		const tl = mapPt(wm.M, -1, -1), br = mapPt(wm.M, 7, 7);
		const key = [tl[0] * f, tl[1] * f, br[0] * f, br[1] * f];
		const tol = 0.25 * Math.abs(br[0] - tl[0]) * f / 8;
		if (seen.some(k => k.every((v, i) => Math.abs(v - key[i]) < tol))) continue;
		seen.push(key);
		tried++;
		const v = refineLattice(levels, c.li, wm.M, wm.sign);
		if (!v) continue;
		const corners = [mapPt(v.M, -1, -1), mapPt(v.M, 7, -1), mapPt(v.M, 7, 7), mapPt(v.M, -1, 7)];
		const score = Math.max(0, Math.min(1, (v.n / 49) * (1 - Math.min(1, v.rms / (0.25 * v.s)))));
		if (debug) debug.push(`C f=${f} win=${c.n} -> n=${v.n} rms=${v.rms.toFixed(2)} s=${v.s.toFixed(1)} score=${score.toFixed(2)} TL=${corners[0].map(Math.round)} BR=${corners[2].map(Math.round)}`);
		results.push({ corners, score, n: v.n, rms: v.rms, area: Math.abs(polyArea(corners)), box: bbox(corners) });
	}
	// 同一块棋盘的不同窗口（错开一列/一行）：保留验证角点最多的
	results.sort((a, b) => b.n - a.n || a.rms - b.rms);
	const groups = [];
	for (const r of results) if (!groups.some(g => overlap(g.box, r.box) > 0.4)) groups.push(r);
	if (!groups.length) return null;
	// 不同位置的候选：支撑相当（≥ 最多者的 72%）时取面积最大的——主棋盘通常比缩略图/小图标大
	const maxN = groups[0].n;
	let best = null;
	for (const g of groups) {
		if (g.n < 0.72 * maxN || g.score < 0.3) continue;
		if (!best || g.area > best.area) best = g;
	}
	if (!best) return null;
	return { corners: best.corners.map(([x, y]) => [x, y]), score: best.score };
}

function bbox(c) {
	const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// 交并比：只把"同一块棋盘错开一行/一列"的窗口归为一组；嵌在大棋盘里的小格点阵（摩尔纹）不算
function overlap(a, b) {
	const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
	if (w <= 0 || h <= 0) return 0;
	const sa = (a[2] - a[0]) * (a[3] - a[1]), sb = (b[2] - b[0]) * (b[3] - b[1]);
	return (w * h) / (sa + sb - w * h);
}

function polyArea(c) {
	let a = 0;
	for (let i = 0; i < 4; i++) { const [x0, y0] = c[i], [x1, y1] = c[(i + 1) & 3]; a += x0 * y1 - x1 * y0; }
	return a / 2;
}

// 供调试/测试使用
export const _internal = { xscore, integral, fitMap, mapPt, detect, down2, bucketize, voteVectors };
