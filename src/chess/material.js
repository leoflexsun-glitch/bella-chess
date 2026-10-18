// 子力对比：直接数棋盘，而不是累计吃子——从任意局面开局、兵升变后都一样准。

import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, WHITE, BLACK, typeOf, colorOf } from './engine.js';

export const VALUE = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9 };
const ORDER = [QUEEN, ROOK, BISHOP, KNIGHT, PAWN];

// 返回双方相对多出的棋子（按价值从高到低）和净子力分。
// 例：白多一车少一象 → white.extra = [ROOK], black.extra = [BISHOP], white.score = 2。
export function balance(pos) {
	const n = { [WHITE]: {}, [BLACK]: {} };
	for (const t of ORDER) n[WHITE][t] = n[BLACK][t] = 0;
	for (let sq = 0; sq < 128; sq++) {
		if (sq & 0x88) continue;
		const p = pos.board[sq];
		if (p && VALUE[typeOf(p)]) n[colorOf(p)][typeOf(p)]++;
	}
	const side = color => {
		const rival = color === WHITE ? BLACK : WHITE;
		const extra = [];
		let score = 0;
		for (const t of ORDER) {
			const d = n[color][t] - n[rival][t];
			for (let i = 0; i < d; i++) extra.push(t);
			score += d * VALUE[t];
		}
		return { extra, score };
	};
	return { [WHITE]: side(WHITE), [BLACK]: side(BLACK) };
}
