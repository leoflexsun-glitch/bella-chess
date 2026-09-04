// 负极大值搜索，带 alpha-beta 剪枝、静态搜索和渐变的棋子位置评估。

import {
	PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
	typeOf, colorOf, other, onBoard, fileOf, rankOf,
	generateMoves, makeMove, unmakeMove, inCheck, CAPTURE, PROMO
} from './engine.js';

const VALUE = { [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 335, [ROOK]: 500, [QUEEN]: 950, [KING]: 0 };
const PHASE_WEIGHT = { [PAWN]: 0, [KNIGHT]: 1, [BISHOP]: 1, [ROOK]: 2, [QUEEN]: 4, [KING]: 0 };
const TOTAL_PHASE = 24;
const MATE = 100000;

const t = a => Int8Array.from(a);

// 左上角为 a8。数值是厘兵 / 2，让表更紧凑。
const PST_MG = {
	[PAWN]: t([
		0, 0, 0, 0, 0, 0, 0, 0,
		49, 49, 49, 49, 49, 49, 49, 49,
		5, 10, 15, 25, 25, 15, 10, 5,
		2, 5, 8, 22, 22, 8, 5, 2,
		0, 0, 0, 20, 20, 0, 0, 0,
		2, -2, -5, 0, 0, -5, -2, 2,
		2, 5, 5, -20, -20, 5, 5, 2,
		0, 0, 0, 0, 0, 0, 0, 0
	]),
	[KNIGHT]: t([
		-25, -20, -15, -15, -15, -15, -20, -25,
		-20, -10, 0, 0, 0, 0, -10, -20,
		-15, 0, 8, 12, 12, 8, 0, -15,
		-15, 2, 12, 15, 15, 12, 2, -15,
		-15, 0, 12, 15, 15, 12, 0, -15,
		-15, 2, 8, 12, 12, 8, 2, -15,
		-20, -10, 0, 2, 2, 0, -10, -20,
		-25, -20, -15, -15, -15, -15, -20, -25
	]),
	[BISHOP]: t([
		-10, -5, -5, -5, -5, -5, -5, -10,
		-5, 0, 0, 0, 0, 0, 0, -5,
		-5, 0, 2, 5, 5, 2, 0, -5,
		-5, 2, 2, 5, 5, 2, 2, -5,
		-5, 0, 5, 5, 5, 5, 0, -5,
		-5, 5, 5, 5, 5, 5, 5, -5,
		-5, 2, 0, 0, 0, 0, 2, -5,
		-10, -5, -5, -5, -5, -5, -5, -10
	]),
	[ROOK]: t([
		0, 0, 0, 0, 0, 0, 0, 0,
		2, 5, 5, 5, 5, 5, 5, 2,
		-2, 0, 0, 0, 0, 0, 0, -2,
		-2, 0, 0, 0, 0, 0, 0, -2,
		-2, 0, 0, 0, 0, 0, 0, -2,
		-2, 0, 0, 0, 0, 0, 0, -2,
		-2, 0, 0, 0, 0, 0, 0, -2,
		0, 0, 0, 2, 2, 0, 0, 0
	]),
	[QUEEN]: t([
		-10, -5, -5, -2, -2, -5, -5, -10,
		-5, 0, 0, 0, 0, 0, 0, -5,
		-5, 0, 2, 2, 2, 2, 0, -5,
		-2, 0, 2, 2, 2, 2, 0, -2,
		0, 0, 2, 2, 2, 2, 0, -2,
		-5, 2, 2, 2, 2, 2, 0, -5,
		-5, 0, 2, 0, 0, 0, 0, -5,
		-10, -5, -5, -2, -2, -5, -5, -10
	]),
	[KING]: t([
		-15, -20, -20, -25, -25, -20, -20, -15,
		-15, -20, -20, -25, -25, -20, -20, -15,
		-15, -20, -20, -25, -25, -20, -20, -15,
		-15, -20, -20, -25, -25, -20, -20, -15,
		-10, -15, -15, -20, -20, -15, -15, -10,
		-5, -10, -10, -10, -10, -10, -10, -5,
		10, 10, 0, 0, 0, 0, 10, 10,
		10, 15, 4, 0, 0, 4, 15, 10
	])
};

const PST_EG = {
	...PST_MG,
	[PAWN]: t([
		0, 0, 0, 0, 0, 0, 0, 0,
		60, 60, 60, 60, 60, 60, 60, 60,
		40, 40, 40, 40, 40, 40, 40, 40,
		22, 22, 22, 22, 22, 22, 22, 22,
		12, 12, 12, 12, 12, 12, 12, 12,
		5, 5, 5, 5, 5, 5, 5, 5,
		2, 2, 2, 2, 2, 2, 2, 2,
		0, 0, 0, 0, 0, 0, 0, 0
	]),
	[KING]: t([
		-25, -20, -15, -10, -10, -15, -20, -25,
		-15, -8, 0, 5, 5, 0, -8, -15,
		-12, 0, 10, 15, 15, 10, 0, -12,
		-10, 5, 15, 20, 20, 15, 5, -10,
		-10, 5, 15, 20, 20, 15, 5, -10,
		-12, 0, 10, 15, 15, 10, 0, -12,
		-15, -10, 0, 5, 5, 0, -10, -15,
		-25, -20, -15, -12, -12, -15, -20, -25
	])
};

const PASSED_BONUS = [0, 8, 14, 24, 44, 78, 120, 0];

const index64 = (sq, color) => {
	const r = rankOf(sq), f = fileOf(sq);
	return color === WHITE ? r * 8 + f : (7 - r) * 8 + f;
};

export function evaluate(pos) {
	const b = pos.board;
	let mg = 0, eg = 0, phase = 0;
	const pawnFiles = { [WHITE]: new Uint8Array(8), [BLACK]: new Uint8Array(8) };
	const bishops = { [WHITE]: 0, [BLACK]: 0 };
	const pawns = [];

	for (let sq = 0; sq <= 119; sq++) {
		if (!onBoard(sq)) { sq += 7; continue; }
		const p = b[sq];
		if (!p) continue;
		const kind = typeOf(p), color = colorOf(p), sign = color === WHITE ? 1 : -1;
		const i = index64(sq, color);
		phase += PHASE_WEIGHT[kind];
		mg += sign * (VALUE[kind] + PST_MG[kind][i] * 2);
		eg += sign * (VALUE[kind] + PST_EG[kind][i] * 2);
		if (kind === PAWN) { pawnFiles[color][fileOf(sq)]++; pawns.push({ sq, color }); }
		if (kind === BISHOP) bishops[color]++;
	}

	if (bishops[WHITE] >= 2) { mg += 28; eg += 42; }
	if (bishops[BLACK] >= 2) { mg -= 28; eg -= 42; }

	for (const { sq, color } of pawns) {
		const sign = color === WHITE ? 1 : -1;
		const f = fileOf(sq);
		const own = pawnFiles[color];
		if (own[f] > 1) { mg -= sign * 12; eg -= sign * 18; }
		if (!(f > 0 && own[f - 1]) && !(f < 7 && own[f + 1])) { mg -= sign * 14; eg -= sign * 20; }
		const foe = pawnFiles[other(color)];
		const blocked = foe[f] || (f > 0 && foe[f - 1]) || (f < 7 && foe[f + 1]);
		if (!blocked) {
			const advance = color === WHITE ? 7 - rankOf(sq) : rankOf(sq);
			mg += sign * PASSED_BONUS[advance] * 0.5;
			eg += sign * PASSED_BONUS[advance];
		}
	}

	const p = Math.min(phase, TOTAL_PHASE) / TOTAL_PHASE;
	const score = mg * p + eg * (1 - p);
	return pos.turn === WHITE ? score : -score;
}

const scoreMove = (move, killers, history, ply) => {
	if (move.flags & PROMO) return 900000 + VALUE[move.promotion];
	if (move.flags & CAPTURE) return 800000 + VALUE[typeOf(move.captured)] * 10 - VALUE[typeOf(move.piece)];
	if (killers[ply] && killers[ply][0] === move.from && killers[ply][1] === move.to) return 700000;
	return history[move.from * 128 + move.to] | 0;
};

function orderMoves(moves, killers, history, ply, first) {
	for (const m of moves) {
		m._s = (first && m.from === first.from && m.to === first.to && m.promotion === first.promotion)
			? 1000000 : scoreMove(m, killers, history, ply);
	}
	moves.sort((a, b) => b._s - a._s);
	return moves;
}

function quiesce(pos, alpha, beta, ctx) {
	ctx.nodes++;
	const stand = evaluate(pos);
	if (stand >= beta) return beta;
	if (stand > alpha) alpha = stand;
	if (ctx.nodes > ctx.budget) return alpha;

	const moves = generateMoves(pos, { capturesOnly: true });
	moves.sort((a, b) => (VALUE[typeOf(b.captured)] || 0) - (VALUE[typeOf(a.captured)] || 0));
	for (const move of moves) {
		const undo = makeMove(pos, move);
		const score = -quiesce(pos, -beta, -alpha, ctx);
		unmakeMove(pos, move, undo);
		if (score >= beta) return beta;
		if (score > alpha) alpha = score;
	}
	return alpha;
}

function negamax(pos, depth, alpha, beta, ply, ctx) {
	if (ctx.nodes > ctx.budget || Date.now() > ctx.deadline) { ctx.aborted = true; return alpha; }
	ctx.nodes++;

	const checked = inCheck(pos);
	if (checked) depth++;
	if (depth <= 0) return quiesce(pos, alpha, beta, ctx);

	const moves = generateMoves(pos);
	if (!moves.length) return checked ? -MATE + ply : 0;
	if (pos.half >= 100) return 0;

	orderMoves(moves, ctx.killers, ctx.history, ply, ply === 0 ? ctx.best : null);

	for (let i = 0; i < moves.length; i++) {
		const move = moves[i];
		const undo = makeMove(pos, move);
		let score;
		if (i === 0) {
			score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, ctx);
		} else {
			const reduce = depth >= 3 && i >= 4 && !(move.flags & (CAPTURE | PROMO)) && !checked ? 1 : 0;
			score = -negamax(pos, depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, ctx);
			if (score > alpha && score < beta) score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, ctx);
		}
		unmakeMove(pos, move, undo);
		if (ctx.aborted) return alpha;

		if (score > alpha) {
			alpha = score;
			if (ply === 0) ctx.rootMove = move;
			if (score >= beta) {
				if (!(move.flags & (CAPTURE | PROMO))) {
					ctx.killers[ply] = [move.from, move.to];
					ctx.history[move.from * 128 + move.to] = (ctx.history[move.from * 128 + move.to] | 0) + depth * depth;
				}
				return beta;
			}
		}
	}
	if (ply === 0 && !ctx.rootMove) ctx.rootMove = moves[0];
	return alpha;
}

export const LEVELS = {
	novice: { depth: 2, ms: 220, blunder: 0.34, spread: 90 },
	club: { depth: 4, ms: 700, blunder: 0.12, spread: 45 },
	expert: { depth: 6, ms: 1600, blunder: 0.03, spread: 18 },
	master: { depth: 8, ms: 3200, blunder: 0, spread: 0 }
};

export function search(pos, { level = 'club', nodeBudget = 4e6 } = {}) {
	const cfg = LEVELS[level] || LEVELS.club;
	const ctx = {
		nodes: 0,
		budget: nodeBudget,
		deadline: Date.now() + cfg.ms,
		killers: [],
		history: new Int32Array(128 * 128),
		aborted: false,
		best: null,
		rootMove: null
	};

	const legal = generateMoves(pos);
	if (!legal.length) return { move: null, score: 0, depth: 0, nodes: 0 };

	let best = legal[0], score = 0, reached = 0;
	for (let depth = 1; depth <= cfg.depth; depth++) {
		ctx.rootMove = null;
		ctx.best = best;
		const value = negamax(pos, depth, -Infinity, Infinity, 0, ctx);
		if (ctx.aborted && depth > 1) break;
		if (ctx.rootMove) { best = ctx.rootMove; score = value; reached = depth; }
		if (Math.abs(score) > MATE - 100) break;
		if (Date.now() > ctx.deadline) break;
	}

	// 较弱的等级偶尔会退而求其次，选一个接近最优的着法，
	// 这样重开的对局会走向不同的局面，人类也有错可抓。
	if (legal.length > 1 && cfg.spread > 0 && Math.random() < cfg.blunder) {
		const scored = legal.map(move => {
			const undo = makeMove(pos, move);
			const value = -quiesce(pos, -Infinity, Infinity, { nodes: 0, budget: 40000 });
			unmakeMove(pos, move, undo);
			return { move, value };
		}).sort((a, b) => b.value - a.value);
		const pool = scored.filter(x => scored[0].value - x.value <= cfg.spread);
		if (pool.length > 1) best = pool[1 + Math.floor(Math.random() * (pool.length - 1))].move;
	}

	return { move: best, score, depth: reached, nodes: ctx.nodes };
}
