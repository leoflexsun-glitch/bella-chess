// eval_flip.py 的 node 端：每个局面按白方在下（未翻转）和黑方在下（翻转）各判一次
import fs from 'node:fs';
import { guessFlipped } from '../../src/vision/chess.js';

const pos = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let ok = 0;
const byPhase = { opening: [0, 0], middle: [0, 0], end: [0, 0] };
for (const sq of pos) {
	const pieces = sq.filter(Boolean).length;
	const ph = pieces > 26 ? 'opening' : pieces > 14 ? 'middle' : 'end';
	for (const flipped of [false, true]) {
		const g = guessFlipped(flipped ? sq.slice().reverse() : sq);
		const good = g === flipped;
		ok += good;
		byPhase[ph][0] += good; byPhase[ph][1]++;
	}
}
console.log(`guessFlipped accuracy: ${(100 * ok / pos.length / 2).toFixed(1)}% over ${pos.length * 2} displays`);
for (const [k, [a, n]] of Object.entries(byPhase)) if (n) console.log(`  ${k.padEnd(8)} (${n}): ${(100 * a / n).toFixed(1)}%`);
