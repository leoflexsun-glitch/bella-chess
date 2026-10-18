// 走法生成正确性：perft 数出某局面往下 N 层的全部合法着法，与公认标准值逐一比对。
// 覆盖王车易位、吃过路兵、升变、将军应对等所有规则分支。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromFen, toFen, generateMoves, makeMove, unmakeMove } from '../src/chess/engine.js';

function perft(pos, depth) {
	if (!depth) return 1;
	let nodes = 0;
	for (const move of generateMoves(pos)) {
		const undo = makeMove(pos, move);
		nodes += perft(pos, depth - 1);
		unmakeMove(pos, move, undo);
	}
	return nodes;
}

const CASES = [
	['初始局面', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
	['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
	['残局吃过路兵', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624],
	['升变与易位', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 4, 422333],
	['将军应对', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379]
];

for (const [name, fen, depth, expected] of CASES) {
	test(`perft ${name} 深度 ${depth}`, () => {
		const pos = fromFen(fen);
		assert.equal(perft(pos, depth), expected);
		assert.equal(toFen(pos), fen, 'make/unmake 后局面必须完全复原');
	});
}
