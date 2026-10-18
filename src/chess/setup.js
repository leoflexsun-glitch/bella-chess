// 自定义局面：严格解析 FEN、校验能否开局、推断易位权。
// 摆棋编辑器和拍照复刻都走这里；纯函数，不碰界面。

import {
	PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
	fromFen, toFen, inCheck, generateMoves, other, typeOf, colorOf, parseSquare
} from './engine.js';

const LETTERS = 'pnbrqk';
const NAMES = { [PAWN]: '兵', [KNIGHT]: '马', [BISHOP]: '象', [ROOK]: '车', [QUEEN]: '后', [KING]: '王' };
export const SIDE_NAME = { [WHITE]: '白方', [BLACK]: '黑方' };

// 易位需要王和对应的车都还在原位。
const HOME = {
	K: { king: 0x74, rook: 0x77, color: WHITE },
	Q: { king: 0x74, rook: 0x70, color: WHITE },
	k: { king: 0x04, rook: 0x07, color: BLACK },
	q: { king: 0x04, rook: 0x00, color: BLACK }
};

// 只检查语法：六段齐全、每行 8 格、字符合法。返回错误文本或 null。
export function fenSyntaxError(fen) {
	const parts = String(fen ?? '').trim().split(/\s+/);
	if (parts.length < 1 || !parts[0]) return 'FEN 为空';
	const rows = parts[0].split('/');
	if (rows.length !== 8) return `棋盘应有 8 行，实际 ${rows.length} 行`;
	for (let i = 0; i < 8; i++) {
		let width = 0;
		for (const ch of rows[i]) {
			if (ch >= '1' && ch <= '8') width += Number(ch);
			else if (LETTERS.includes(ch.toLowerCase())) width += 1;
			else return `第 ${8 - i} 行有非法字符「${ch}」`;
		}
		if (width !== 8) return `第 ${8 - i} 行应有 8 格，实际 ${width} 格`;
	}
	if (parts[1] && !/^[wb]$/.test(parts[1])) return '行棋方应为 w 或 b';
	if (parts[2] && !/^(-|K?Q?k?q?)$/.test(parts[2])) return '易位权格式不对';
	if (parts[3] && parts[3] !== '-' && parseSquare(parts[3]) < 0) return '过路兵格式不对';
	return null;
}

// 当前棋子摆法下，哪些易位权在物理上还可能存在。
export function possibleCastling(pos) {
	const out = {};
	for (const [flag, { king, rook, color }] of Object.entries(HOME)) {
		out[flag] = pos.board[king] === (KING | color) && pos.board[rook] === (ROOK | color);
	}
	return out;
}

// 把易位权和过路兵格修正到与摆法一致（不可能的权利直接去掉）。
export function normalize(pos) {
	const possible = possibleCastling(pos);
	const bits = { K: 1, Q: 2, k: 4, q: 8 };
	for (const flag of Object.keys(bits)) if (!possible[flag]) pos.castling &= ~bits[flag];
	if (pos.ep >= 0 && !epPossible(pos)) pos.ep = -1;
	return pos;
}

// 过路兵格成立的条件：轮到的一方有兵能吃到，且对方刚走的兵就在格子前方。
function epPossible(pos) {
	const us = pos.turn, them = other(us);
	const rank = pos.ep >> 4;
	if (rank !== (us === WHITE ? 2 : 5)) return false;
	const pawnSq = pos.ep + (us === WHITE ? 16 : -16);
	if (pos.board[pawnSq] !== (PAWN | them) || pos.board[pos.ep]) return false;
	return generateMoves(pos).some(m => m.to === pos.ep && typeOf(m.piece) === PAWN);
}

function counts(pos) {
	const c = { [WHITE]: {}, [BLACK]: {} };
	for (const color of [WHITE, BLACK]) for (let t = PAWN; t <= KING; t++) c[color][t] = 0;
	for (let sq = 0; sq < 128; sq++) {
		if (sq & 0x88) continue;
		const p = pos.board[sq];
		if (p) c[colorOf(p)][typeOf(p)]++;
	}
	return c;
}

// 能否从这个局面开局。返回中文错误列表；空数组表示合法。
export function validate(pos) {
	const errors = [];
	const c = counts(pos);

	for (const color of [WHITE, BLACK]) {
		const n = c[color];
		const name = SIDE_NAME[color];
		if (n[KING] !== 1) errors.push(n[KING] ? `${name}有 ${n[KING]} 个王，只能有 1 个` : `${name}缺少王`);
		if (n[PAWN] > 8) errors.push(`${name}有 ${n[PAWN]} 个兵，最多 8 个`);
		const total = Object.values(n).reduce((a, b) => a + b, 0);
		if (total > 16) errors.push(`${name}有 ${total} 个棋子，最多 16 个`);
		// 多出的后/车/象/马只能来自兵升变。
		const promoted = Math.max(0, n[QUEEN] - 1) + Math.max(0, n[ROOK] - 2) + Math.max(0, n[BISHOP] - 2) + Math.max(0, n[KNIGHT] - 2);
		if (n[PAWN] <= 8 && promoted > 8 - n[PAWN]) errors.push(`${name}升变出的棋子太多（兵 ${n[PAWN]} 个时最多多出 ${8 - n[PAWN]} 个）`);
	}

	for (let f = 0; f < 8; f++) {
		for (const sq of [f, 0x70 + f]) {
			if (typeOf(pos.board[sq]) === PAWN) {
				errors.push(`${'abcdefgh'[f]}${sq >= 0x70 ? 1 : 8} 上有兵：兵不能在第 1 或第 8 行`);
			}
		}
	}

	if (errors.length) return errors;

	// 王的位置已确定，才能谈将军。
	const waiting = other(pos.turn);
	if (inCheck(pos, waiting)) errors.push(`轮到${SIDE_NAME[pos.turn]}走，但${SIDE_NAME[waiting]}的王正被将军——不可能出现，请检查行棋方`);
	return errors;
}

// 局面一开始就结束了吗（被将杀/逼和）。用于在开局前给出提示。
export function terminalState(pos) {
	if (generateMoves(pos).length) return null;
	return inCheck(pos) ? 'checkmate' : 'stalemate';
}

// 解析 + 修正 + 校验，一步到位。
export function prepare(fen) {
	const syntax = fenSyntaxError(fen);
	if (syntax) return { pos: null, fen: null, errors: [syntax] };
	const pos = normalize(fromFen(fen));
	const errors = validate(pos);
	if (!errors.length) {
		const end = terminalState(pos);
		if (end) errors.push(end === 'checkmate' ? `${SIDE_NAME[pos.turn]}已被将杀，无法继续` : `${SIDE_NAME[pos.turn]}无子可动（逼和），无法继续`);
	}
	return { pos, fen: toFen(pos), errors };
}

export const pieceName = type => NAMES[type];
