// 棋图识别模块的回归测试：node --test tests/vision/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from '../../tools/vision/png.mjs';
import { locateBoard, readBoard, guessFlipped, toPlacement, recognize } from '../../src/vision/index.js';
import { applyPriors, CLASSES } from '../../src/vision/chess.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIX = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures.json'), 'utf8'));
const load = f => decodePNG(fs.readFileSync(path.join(DIR, f)));
const cornerErr = (a, b) => Math.max(...a.map((c, i) => Math.hypot(c[0] - b[i][0], c[1] - b[i][1])));
const boardW = c => Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);

for (const fx of FIX) {
	test(`locateBoard: ${fx.file}`, () => {
		const img = load(fx.file);
		const r = locateBoard(img);
		assert.ok(r, 'board not found');
		assert.equal(r.corners.length, 4);
		for (const c of r.corners) { assert.equal(c.length, 2); assert.ok(Number.isFinite(c[0]) && Number.isFinite(c[1])); }
		assert.ok(r.score >= 0 && r.score <= 1);
		const err = cornerErr(r.corners, fx.corners) / boardW(fx.corners);
		assert.ok(err <= 0.02, `corner error ${(err * 100).toFixed(2)}% of board width`);
	});

	test(`readBoard (true corners): ${fx.file}`, () => {
		const r = readBoard(load(fx.file), fx.corners);
		assert.equal(r.squares.length, 64);
		assert.ok(r.confidence instanceof Float32Array && r.confidence.length === 64);
		for (const v of r.squares) assert.ok(CLASSES.includes(v));
		const wrong = [];
		r.squares.forEach((v, i) => { if (v !== fx.squares[i]) wrong.push(`${i}:${fx.squares[i] || '.'}->${v || '.'}`); });
		assert.deepEqual(wrong, [], 'misread squares');
	});

	test(`guessFlipped + toPlacement: ${fx.file}`, () => {
		assert.equal(guessFlipped(fx.squares), fx.flipped);
		assert.equal(toPlacement(fx.squares, fx.flipped), fx.placement);
	});

	test(`recognize end-to-end: ${fx.file}`, () => {
		const r = recognize(load(fx.file));
		assert.ok(r);
		for (const k of ['corners', 'squares', 'confidence', 'flipped', 'placement']) assert.ok(k in r, k);
		assert.equal(r.flipped, fx.flipped);
		assert.equal(r.placement, fx.placement);
	});
}

// 求把四点 from 映到 to 的单应 [a..h]（x' = (a x + b y + c)/(g x + h y + 1)）
function solveH(from, to) {
	const A = [], b = [];
	for (let k = 0; k < 4; k++) {
		const [x, y] = from[k], [u, v] = to[k];
		A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
		A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
	}
	for (let c = 0; c < 8; c++) {
		let p = c;
		for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
		[A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
		for (let r = 0; r < 8; r++) {
			if (r === c) continue;
			const f = A[r][c] / A[c][c];
			for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
			b[r] -= f * b[c];
		}
	}
	return b.map((v, i) => v / A[i][i]);
}
const applyH = (h, [x, y]) => { const z = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / z, (h[3] * x + h[4] * y + h[5]) / z]; };

// 把整幅图透视变形到 W×H 画布上的四边形 dst（逐像素逆映射 + 双线性）
function perspectiveWarp(img, dst, W, H) {
	const src = [[0, 0], [img.width, 0], [img.width, img.height], [0, img.height]];
	const inv = solveH(dst, src);
	const out = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const [su, sv] = applyH(inv, [x + 0.5, y + 0.5]);
		const u = su - 0.5, v = sv - 0.5, o = (y * W + x) * 4;
		out[o + 3] = 255;
		if (u < 0 || v < 0 || u > img.width - 1 || v > img.height - 1) { out[o] = out[o + 1] = out[o + 2] = 30; continue; }
		const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
		const wx = u - x0, wy = v - y0;
		for (let k = 0; k < 3; k++) {
			const g = (yy, xx) => img.data[(yy * img.width + xx) * 4 + k];
			out[o + k] = (g(y0, x0) * (1 - wx) + g(y0, x1) * wx) * (1 - wy) + (g(y1, x0) * (1 - wx) + g(y1, x1) * wx) * wy;
		}
	}
	return { width: W, height: H, data: out, fwd: solveH(src, dst) };
}

test('readBoard/locateBoard handle a perspective quad (homography warp)', () => {
	const fx = FIX[1];
	const img = load(fx.file);
	const dst = [[40, 25], [img.width - 10, 0], [img.width - 45, img.height - 20], [0, img.height - 5]];
	const warped = perspectiveWarp(img, dst, img.width + 10, img.height + 10);
	const quad = fx.corners.map(c => applyH(warped.fwd, c));
	const r = readBoard(warped, quad);
	const wrong = r.squares.filter((v, i) => v !== fx.squares[i]).length;
	assert.ok(wrong <= 1, `${wrong} squares wrong on perspective-warped board`);
	const loc = locateBoard(warped);
	assert.ok(loc, 'perspective board not located');
	assert.ok(cornerErr(loc.corners, quad) / boardW(quad) <= 0.02);
});

test('locateBoard returns null when there is no board', () => {
	const W = 400, H = 300, data = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const o = (y * W + x) * 4, v = 200 + ((x * 7 + y * 13) % 17);
		data[o] = v; data[o + 1] = v; data[o + 2] = 220; data[o + 3] = 255;
	}
	// 几个色块和横线（类似 UI），不应被当作棋盘
	for (let y = 40; y < 80; y++) for (let x = 30; x < 200; x++) { const o = (y * W + x) * 4; data[o] = 40; data[o + 1] = 90; data[o + 2] = 160; }
	for (let k = 0; k < 6; k++) for (let x = 220; x < 380; x++) { const o = ((120 + k * 20) * W + x) * 4; data[o] = data[o + 1] = data[o + 2] = 20; }
	assert.equal(locateBoard({ width: W, height: H, data }), null);
	assert.equal(recognize({ width: W, height: H, data }), null);
});

test('toPlacement: orientation handling', () => {
	const sq = new Array(64).fill('');
	sq[0] = 'r'; sq[63] = 'K'; sq[12] = 'p';
	assert.equal(toPlacement(sq, false), 'r7/4p3/8/8/8/8/8/7K');
	assert.equal(toPlacement(sq, true), 'K7/8/8/8/8/8/3p4/7r');
	const start = 'rnbqkbnrpppppppp' + ' '.repeat(32) + 'PPPPPPPPRNBQKBNR';
	const s2 = [...start].map(c => c === ' ' ? '' : c);
	assert.equal(toPlacement(s2, false), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
	assert.equal(guessFlipped(s2), false);
	assert.equal(guessFlipped(s2.slice().reverse()), true);
});

test('applyPriors: one king per side, no pawns on back ranks, at most 8 pawns', () => {
	const K = 13, probs = new Float32Array(64 * K);
	const set = (i, c, p) => { probs.fill((1 - p) / 12, i * K, (i + 1) * K); probs[i * K + CLASSES.indexOf(c)] = p; };
	for (let i = 0; i < 64; i++) set(i, '', 0.9);
	set(10, 'K', 0.9); set(20, 'K', 0.6);   // 两个白王：较弱的被改判
	probs[20 * K + CLASSES.indexOf('Q')] = 0.3;
	set(3, 'p', 0.8);                         // 第一行的兵：不可能
	probs[3 * K + CLASSES.indexOf('b')] = 0.15;
	for (let i = 0; i < 9; i++) set(40 + i, 'P', 0.7 + i * 0.01); // 9 个白兵：最弱的被改判
	const { squares, confidence } = applyPriors(probs);
	assert.equal(squares.filter(v => v === 'K').length, 1);
	assert.equal(squares[10], 'K');
	assert.equal(squares[20], 'Q');
	assert.equal(squares[3], 'b');
	assert.equal(squares.filter(v => v === 'P').length, 8);
	assert.notEqual(squares[40], 'P');
	assert.ok(confidence.every(c => c >= 0 && c <= 1));
});

test('PNG codec round-trip', () => {
	const W = 7, H = 5, data = new Uint8ClampedArray(W * H * 4);
	for (let i = 0; i < data.length; i++) data[i] = (i * 37) & 255;
	for (let i = 3; i < data.length; i += 4) data[i] = 255;
	const back = decodePNG(encodePNG({ width: W, height: H, data }));
	assert.equal(back.width, W);
	assert.deepEqual(Array.from(back.data), Array.from(data));
});
