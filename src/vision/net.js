// 手写的小型 CNN 推理：conv3×3(same)+ReLU / maxpool2 / dense。
// 激活布局为 [C][B·H·W]（通道在外、批在内），卷积 = im2col + GEMM，64 格一起算。
// GEMM 两个操作数都预先打包成 4 宽的条带（[块][K][4]），内层循环只做顺序读，
// 否则按列跨步访问会被缓存未命中拖慢 4 倍以上。

// C[M×N] = A·B + bias（可选 ReLU）。Ap: [M/4][K][4]，Bp: [N/4][K][4]，M、N 均为 4 的倍数。
function gemm(Ap, Bp, bias, M, K, N, relu) {
	const C = new Float32Array(M * N);
	const K4 = K * 4;
	for (let m = 0; m < M; m += 4) {
		const ao = m * K;
		const b0 = bias[m], b1 = bias[m + 1], b2 = bias[m + 2], b3 = bias[m + 3];
		const o0 = m * N, o1 = o0 + N, o2 = o1 + N, o3 = o2 + N;
		for (let n = 0, bo = 0; n < N; n += 4, bo += K4) {
			let c00 = b0, c01 = b0, c02 = b0, c03 = b0;
			let c10 = b1, c11 = b1, c12 = b1, c13 = b1;
			let c20 = b2, c21 = b2, c22 = b2, c23 = b2;
			let c30 = b3, c31 = b3, c32 = b3, c33 = b3;
			for (let i = 0; i < K4; i += 4) {
				const x0 = Bp[bo + i], x1 = Bp[bo + i + 1], x2 = Bp[bo + i + 2], x3 = Bp[bo + i + 3];
				const w0 = Ap[ao + i], w1 = Ap[ao + i + 1], w2 = Ap[ao + i + 2], w3 = Ap[ao + i + 3];
				c00 += w0 * x0; c01 += w0 * x1; c02 += w0 * x2; c03 += w0 * x3;
				c10 += w1 * x0; c11 += w1 * x1; c12 += w1 * x2; c13 += w1 * x3;
				c20 += w2 * x0; c21 += w2 * x1; c22 += w2 * x2; c23 += w2 * x3;
				c30 += w3 * x0; c31 += w3 * x1; c32 += w3 * x2; c33 += w3 * x3;
			}
			if (relu) {
				C[o0 + n] = c00 > 0 ? c00 : 0; C[o0 + n + 1] = c01 > 0 ? c01 : 0; C[o0 + n + 2] = c02 > 0 ? c02 : 0; C[o0 + n + 3] = c03 > 0 ? c03 : 0;
				C[o1 + n] = c10 > 0 ? c10 : 0; C[o1 + n + 1] = c11 > 0 ? c11 : 0; C[o1 + n + 2] = c12 > 0 ? c12 : 0; C[o1 + n + 3] = c13 > 0 ? c13 : 0;
				C[o2 + n] = c20 > 0 ? c20 : 0; C[o2 + n + 1] = c21 > 0 ? c21 : 0; C[o2 + n + 2] = c22 > 0 ? c22 : 0; C[o2 + n + 3] = c23 > 0 ? c23 : 0;
				C[o3 + n] = c30 > 0 ? c30 : 0; C[o3 + n + 1] = c31 > 0 ? c31 : 0; C[o3 + n + 2] = c32 > 0 ? c32 : 0; C[o3 + n + 3] = c33 > 0 ? c33 : 0;
			} else {
				C[o0 + n] = c00; C[o0 + n + 1] = c01; C[o0 + n + 2] = c02; C[o0 + n + 3] = c03;
				C[o1 + n] = c10; C[o1 + n + 1] = c11; C[o1 + n + 2] = c12; C[o1 + n + 3] = c13;
				C[o2 + n] = c20; C[o2 + n + 1] = c21; C[o2 + n + 2] = c22; C[o2 + n + 3] = c23;
				C[o3 + n] = c30; C[o3 + n + 1] = c31; C[o3 + n + 2] = c32; C[o3 + n + 3] = c33;
			}
		}
	}
	return C;
}

// 首层（单通道输入）直接卷积：每个像素读 9 个邻居、算出全部 M 个输出，免去 im2col 和窄 K 的 GEMM 开销
function conv1(x, w, bias, M, B, H, W, relu) {
	const HW = H * W, N = B * HW;
	const out = new Float32Array(M * N);
	for (let b = 0; b < B; b++) {
		const base = b * HW;
		for (let y = 0; y < H; y++) {
			const up = y > 0, dn = y < H - 1;
			const r1 = base + y * W, r0 = r1 - W, r2 = r1 + W;
			for (let xx = 0; xx < W; xx++) {
				const lf = xx > 0, rt = xx < W - 1;
				const n0 = up && lf ? x[r0 + xx - 1] : 0, n1 = up ? x[r0 + xx] : 0, n2 = up && rt ? x[r0 + xx + 1] : 0;
				const n3 = lf ? x[r1 + xx - 1] : 0, n4 = x[r1 + xx], n5 = rt ? x[r1 + xx + 1] : 0;
				const n6 = dn && lf ? x[r2 + xx - 1] : 0, n7 = dn ? x[r2 + xx] : 0, n8 = dn && rt ? x[r2 + xx + 1] : 0;
				const p = r1 + xx;
				for (let m = 0, o = 0; m < M; m++, o += 9) {
					const v = bias[m] + w[o] * n0 + w[o + 1] * n1 + w[o + 2] * n2 + w[o + 3] * n3 + w[o + 4] * n4 +
						w[o + 5] * n5 + w[o + 6] * n6 + w[o + 7] * n7 + w[o + 8] * n8;
					out[m * N + p] = relu && v < 0 ? 0 : v;
				}
			}
		}
	}
	return out;
}

// im2col 直接写成打包布局：输入 [C][B][H][W] → [P/4][C·9][4]，越界补零。要求 W 是 4 的倍数，
// 于是每 4 个相邻像素正好落在同一条带里、写入连续的 4 个 float。
function im2col(x, C, B, H, W) {
	const HW = H * W, P = B * HW, K = C * 9, K4 = K * 4;
	const col = new Float32Array(P * K);
	for (let c = 0; c < C; c++) {
		for (let t = 0; t < 9; t++) {
			const dy = ((t / 3) | 0) - 1, dx = (t % 3) - 1, k4 = (c * 9 + t) * 4;
			for (let b = 0; b < B; b++) {
				const src = (c * B + b) * HW;
				for (let y = 0; y < H; y++) {
					const sy = y + dy;
					if (sy < 0 || sy >= H) continue;
					const row = src + sy * W + dx;
					let o = ((b * HW + y * W) >> 2) * K4 + k4;
					if (dx === 0) {
						for (let xx = 0; xx < W; xx += 4, o += K4) {
							col[o] = x[row + xx]; col[o + 1] = x[row + xx + 1]; col[o + 2] = x[row + xx + 2]; col[o + 3] = x[row + xx + 3];
						}
					} else {
						for (let xx = 0; xx < W; xx += 4, o += K4) {
							for (let j = 0; j < 4; j++) {
								const sx = xx + j + dx;
								if (sx >= 0 && sx < W) col[o + j] = x[row + xx + j];
							}
						}
					}
				}
			}
		}
	}
	return col;
}

function maxpool(x, C, B, H, W) {
	const h = H >> 1, w = W >> 1;
	const out = new Float32Array(C * B * h * w);
	for (let p = 0, o = 0; p < C * B; p++) {
		const base = p * H * W;
		for (let y = 0; y < h; y++) {
			const r0 = base + 2 * y * W, r1 = r0 + W;
			for (let xx = 0; xx < w; xx++, o++) {
				const i = 2 * xx;
				let m = x[r0 + i];
				if (x[r0 + i + 1] > m) m = x[r0 + i + 1];
				if (x[r1 + i] > m) m = x[r1 + i];
				if (x[r1 + i + 1] > m) m = x[r1 + i + 1];
				out[o] = m;
			}
		}
	}
	return out;
}

// 权重格式：meta.layers 描述结构；data 为 base64 的二进制块，
// 每层依次存 int8 权重 [out][in(·9)]（按输出通道对称量化，4 字节对齐）+ float32 scale[out] + float32 bias[out]。
function b64ToBytes(s) {
	if (typeof atob === 'function') {
		const bin = atob(s);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	return new Uint8Array(Buffer.from(s, 'base64'));
}

export function loadNet(packed) {
	const bytes = b64ToBytes(packed.data);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let off = 0;
	const layers = packed.meta.layers.map(spec => {
		const L = { ...spec };
		if (spec.type === 'conv' || spec.type === 'dense') {
			const outN = spec.out, K = spec.type === 'conv' ? spec.in * 9 : spec.in;
			const q = new Int8Array(bytes.buffer, bytes.byteOffset + off, outN * K);
			off = (off + outN * K + 3) & ~3;
			const scale = new Float32Array(outN), bias = new Float32Array(outN);
			for (let i = 0; i < outN; i++, off += 4) scale[i] = view.getFloat32(off, true);
			for (let i = 0; i < outN; i++, off += 4) bias[i] = view.getFloat32(off, true);
			// 输出通道补零到 4 的倍数并打包成 [M/4][K][4]
			const M = (outN + 3) & ~3;
			const w = new Float32Array(M * K), b = new Float32Array(M);
			for (let o = 0; o < outN; o++) {
				const base = (o >> 2) * K * 4 + (o & 3);
				for (let k = 0; k < K; k++) w[base + k * 4] = q[o * K + k] * scale[o];
				b[o] = bias[o];
			}
			L.w = w; L.b = b; L.M = M; L.K = K;
			if (spec.type === 'conv' && spec.in === 1) {
				L.wRaw = new Float32Array(outN * 9);
				for (let o = 0; o < outN; o++) for (let k = 0; k < 9; k++) L.wRaw[o * 9 + k] = q[o * K + k] * scale[o];
			}
		}
		return L;
	});
	return { meta: packed.meta, layers };
}

// tiles: Float32Array(B·S·S)，返回 Float32Array(B·classes) 的 softmax 概率
export function runNet(net, tiles, B) {
	const S = net.meta.input;
	let C = 1, H = S, W = S;
	let x = tiles; // [B][1][S][S] 与 [1][B][S][S] 内存布局相同
	let Bp = B; // dense 阶段把批补到 4 的倍数
	for (const L of net.layers) {
		if (L.type === 'conv') {
			x = C === 1
				? conv1(x, L.wRaw, L.b, L.out, B, H, W, L.relu)
				: gemm(L.w, im2col(x, C, B, H, W), L.b, L.M, L.K, B * H * W, L.relu);
			C = L.out;
		} else if (L.type === 'pool') {
			x = maxpool(x, C, B, H, W); H >>= 1; W >>= 1;
		} else if (L.type === 'dense') {
			let packedIn;
			if (H > 0) {
				// 首个 dense：[C][B][H][W] 按 PyTorch flatten 顺序 (c,y,x) 打包成 [Bp/4][F][4]
				const F = C * H * W, HW = H * W;
				Bp = (B + 3) & ~3;
				packedIn = new Float32Array(Bp * F);
				for (let c = 0; c < C; c++) for (let b = 0; b < B; b++) {
					const src = (c * B + b) * HW, dst = (b >> 2) * F * 4 + (b & 3);
					for (let i = 0; i < HW; i++) packedIn[dst + (c * HW + i) * 4] = x[src + i];
				}
				C = F; H = 0;
			} else {
				// 上一层输出 [M][Bp] → [Bp/4][C][4]
				packedIn = new Float32Array(Bp * C);
				for (let c = 0; c < C; c++) for (let b = 0; b < Bp; b++) {
					packedIn[(b >> 2) * C * 4 + c * 4 + (b & 3)] = x[c * Bp + b];
				}
			}
			x = gemm(L.w, packedIn, L.b, L.M, L.K, Bp, L.relu);
			C = L.out;
		}
	}
	// x: [classes][Bp] → softmax → [B][classes]
	const K = C, probs = new Float32Array(B * K);
	for (let b = 0; b < B; b++) {
		let mx = -Infinity;
		for (let k = 0; k < K; k++) mx = Math.max(mx, x[k * Bp + b]);
		let s = 0;
		for (let k = 0; k < K; k++) { const e = Math.exp(x[k * Bp + b] - mx); probs[b * K + k] = e; s += e; }
		for (let k = 0; k < K; k++) probs[b * K + k] /= s;
	}
	return probs;
}

// 近乎纯色的格子（原始灰度标准差 < 1.2 级）不可能有棋子：直接判空，只把其余格子送进网络。
// 只看内圈（去掉 2px 边）：重采样时最外一圈会混进相邻格的颜色，而棋子不可能只出现在边缘那一圈。
// 典型局面里一半以上是空格，截图上能省掉约一半推理时间；纹理/噪声大的图自然全部走网络。
export const FLAT_STD = 1.2;

export function flatMask(rawTiles, S, B) {
	const m0 = 2, m1 = S - 2, n = (m1 - m0) * (m1 - m0), mask = new Uint8Array(B);
	for (let b = 0; b < B; b++) {
		let s = 0, s2 = 0;
		for (let y = m0; y < m1; y++) {
			for (let i = b * S * S + y * S + m0, e = i + m1 - m0; i < e; i++) { const v = rawTiles[i]; s += v; s2 += v * v; }
		}
		const m = s / n;
		// 过曝/死黑的格子例外：白子在亮格上被眩光洗成一片 255 时，残留细节只在网络眼里还有用
		mask[b] = m > 6 && m < 249 && s2 / n - m * m < FLAT_STD * FLAT_STD ? 1 : 0;
	}
	return mask;
}

// 返回 Float32Array(B·classes)；mask[b]=1 的格子记为空格（类别 0）
export function classifyTiles(net, tiles, B, mask = null) {
	const S = net.meta.input, n = S * S, K = net.meta.classes.length;
	const idx = [];
	for (let b = 0; b < B; b++) if (!mask || !mask[b]) idx.push(b);
	const probs = new Float32Array(B * K);
	for (let b = 0; b < B; b++) if (mask && mask[b]) probs[b * K] = 1;
	if (!idx.length) return probs;
	let x = tiles;
	if (idx.length < B) {
		x = new Float32Array(idx.length * n);
		idx.forEach((b, k) => x.set(tiles.subarray(b * n, (b + 1) * n), k * n));
	}
	const p = runNet(net, x, idx.length);
	idx.forEach((b, k) => probs.set(p.subarray(k * K, (k + 1) * K), b * K));
	return probs;
}
