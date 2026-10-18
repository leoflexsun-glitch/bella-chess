#!/usr/bin/env node
// 用运行端的 JS 推理（int8 权重 + 棋规先验，与 readBoard 完全相同的代码路径）评测预采样的格子集。
// 用法：node tools/vision/eval_tiles.mjs [--weights path.js] base1 [base2 ...]   （base 为 dump_eval.py 的输出前缀）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadNet, runNet } from '../../src/vision/net.js';
import { applyPriors, CLASSES } from '../../src/vision/chess.js';

const args = process.argv.slice(2);
let wpath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/vision/weights.js');
const wi = args.indexOf('--weights');
if (wi >= 0) { wpath = path.resolve(args[wi + 1]); args.splice(wi, 2); }
const { WEIGHTS } = await import(pathToFileURL(wpath));
const net = loadNet(WEIGHTS);
const S = WEIGHTS.meta.input, EPS = WEIGHTS.meta.eps ?? 8;

for (const base of args) {
	const tiles = fs.readFileSync(base + '.u8'), labels = fs.readFileSync(base + '.lab');
	const sb = fs.readFileSync(base + '.f32');
	const stats = new Float32Array(sb.buffer, sb.byteOffset, sb.byteLength / 4);
	const sets = fs.existsSync(base + '.sets') ? fs.readFileSync(base + '.sets', 'utf8').split('\n') : [];
	const nb = labels.length / 64;
	let ok = 0, okRaw = 0, exact = 0, exactRaw = 0, ms = 0;
	const conf = new Map(), perSet = new Map();
	const x = new Float32Array(64 * S * S);
	for (let b = 0; b < nb; b++) {
		const mean = stats[b * 128], std = stats[b * 128 + 1];
		const off = b * 64 * S * S;
		for (let i = 0; i < 64 * S * S; i++) x[i] = (tiles[off + i] - mean) / (std + EPS);
		const t = performance.now();
		const probs = runNet(net, x, 64);
		const { squares } = applyPriors(probs);
		ms += performance.now() - t;
		let k = 0, kr = 0;
		for (let i = 0; i < 64; i++) {
			const want = CLASSES[labels[b * 64 + i]];
			let am = 0;
			for (let c = 1; c < 13; c++) if (probs[i * 13 + c] > probs[i * 13 + am]) am = c;
			if (CLASSES[am] === want) kr++;
			if (squares[i] === want) k++;
			else {
				const key = `${want || '.'}->${squares[i] || '.'}`;
				conf.set(key, (conf.get(key) || 0) + 1);
			}
		}
		ok += k; okRaw += kr;
		if (k === 64) exact++;
		if (kr === 64) exactRaw++;
		const sn = sets[b] || '?';
		const e = perSet.get(sn) || { ok: 0, n: 0, ex: 0, b: 0 };
		e.ok += k; e.n += 64; e.b++; if (k === 64) e.ex++;
		perSet.set(sn, e);
	}
	console.log(`\n${path.basename(base)}: ${nb} boards`);
	console.log(`  per-square ${(100 * ok / nb / 64).toFixed(3)}% (no priors ${(100 * okRaw / nb / 64).toFixed(3)}%), ` +
		`board exact ${(100 * exact / nb).toFixed(1)}% (no priors ${(100 * exactRaw / nb).toFixed(1)}%), ${(ms / nb).toFixed(0)} ms/board`);
	const top = [...conf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
	if (top.length) console.log('  top confusions:', top.map(([k, v]) => `${k}×${v}`).join(' '));
	if (perSet.size > 1 && perSet.size <= 40) {
		const rows = [...perSet.entries()].sort((a, b) => a[0].localeCompare(b[0]));
		for (const [sn, e] of rows) console.log(`    ${sn.padEnd(34)} ${(100 * e.ok / e.n).toFixed(2)}%  exact ${e.ex}/${e.b}`);
	}
}
