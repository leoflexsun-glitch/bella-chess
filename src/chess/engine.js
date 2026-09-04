// 0x88 棋盘上的国际象棋规则。a8 = 0，h1 = 119。

export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 8, BLACK = 16;

const TYPE = 7, COLOR = 24;

export const typeOf = p => p & TYPE;
export const colorOf = p => p & COLOR;
export const other = c => c === WHITE ? BLACK : WHITE;

export const CAPTURE = 1, BIGPAWN = 2, EP = 4, PROMO = 8, KCASTLE = 16, QCASTLE = 32;

const WK = 1, WQ = 2, BK = 4, BQ = 8;

const KNIGHT_STEPS = [-33, -31, -18, -14, 14, 18, 31, 33];
const KING_STEPS = [-17, -16, -15, -1, 1, 15, 16, 17];
const DIAGONALS = [-17, -15, 15, 17];
const ORTHOGONALS = [-16, -1, 1, 16];

const FILES = 'abcdefgh';

export const onBoard = sq => (sq & 0x88) === 0;
export const fileOf = sq => sq & 15;
export const rankOf = sq => sq >> 4;
export const squareName = sq => FILES[sq & 15] + (8 - (sq >> 4));
export const parseSquare = name => {
	const f = FILES.indexOf(name[0]), r = 8 - Number(name[1]);
	return f < 0 || r < 0 || r > 7 ? -1 : r * 16 + f;
};

const PIECE_LETTER = { [PAWN]: 'p', [KNIGHT]: 'n', [BISHOP]: 'b', [ROOK]: 'r', [QUEEN]: 'q', [KING]: 'k' };
const LETTER_PIECE = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function fromFen(fen = START_FEN) {
	const [placement, side, rights, ep, half, full] = fen.trim().split(/\s+/);
	const pos = {
		board: new Int8Array(128),
		turn: side === 'b' ? BLACK : WHITE,
		castling: 0,
		ep: -1,
		half: Number(half ?? 0),
		full: Number(full ?? 1),
		kings: [0, -1, -1]
	};
	let sq = 0;
	for (const ch of placement) {
		if (ch === '/') { sq += 8; continue; }
		if (ch >= '1' && ch <= '8') { sq += Number(ch); continue; }
		const color = ch === ch.toUpperCase() ? WHITE : BLACK;
		const piece = LETTER_PIECE[ch.toLowerCase()] | color;
		pos.board[sq] = piece;
		if (typeOf(piece) === KING) pos.kings[color >> 3] = sq;
		sq++;
	}
	if (rights && rights !== '-') {
		if (rights.includes('K')) pos.castling |= WK;
		if (rights.includes('Q')) pos.castling |= WQ;
		if (rights.includes('k')) pos.castling |= BK;
		if (rights.includes('q')) pos.castling |= BQ;
	}
	if (ep && ep !== '-') pos.ep = parseSquare(ep);
	return pos;
}

export function toFen(pos) {
	let placement = '';
	for (let r = 0; r < 8; r++) {
		let run = 0;
		for (let f = 0; f < 8; f++) {
			const p = pos.board[r * 16 + f];
			if (!p) { run++; continue; }
			if (run) { placement += run; run = 0; }
			const letter = PIECE_LETTER[typeOf(p)];
			placement += colorOf(p) === WHITE ? letter.toUpperCase() : letter;
		}
		if (run) placement += run;
		if (r < 7) placement += '/';
	}
	let rights = '';
	if (pos.castling & WK) rights += 'K';
	if (pos.castling & WQ) rights += 'Q';
	if (pos.castling & BK) rights += 'k';
	if (pos.castling & BQ) rights += 'q';
	return [
		placement,
		pos.turn === WHITE ? 'w' : 'b',
		rights || '-',
		pos.ep >= 0 ? squareName(pos.ep) : '-',
		pos.half,
		pos.full
	].join(' ');
}

export const clone = pos => ({
	board: pos.board.slice(),
	turn: pos.turn,
	castling: pos.castling,
	ep: pos.ep,
	half: pos.half,
	full: pos.full,
	kings: pos.kings.slice()
});

export function isAttacked(pos, sq, by) {
	const b = pos.board;
	const pawnDir = by === WHITE ? 16 : -16;
	for (const side of [-1, 1]) {
		const from = sq + pawnDir + side;
		if (onBoard(from) && b[from] === (PAWN | by)) return true;
	}
	for (const step of KNIGHT_STEPS) {
		const from = sq + step;
		if (onBoard(from) && b[from] === (KNIGHT | by)) return true;
	}
	for (const step of KING_STEPS) {
		const from = sq + step;
		if (onBoard(from) && b[from] === (KING | by)) return true;
	}
	for (const step of DIAGONALS) {
		for (let from = sq + step; onBoard(from); from += step) {
			const p = b[from];
			if (!p) continue;
			if (colorOf(p) === by && (typeOf(p) === BISHOP || typeOf(p) === QUEEN)) return true;
			break;
		}
	}
	for (const step of ORTHOGONALS) {
		for (let from = sq + step; onBoard(from); from += step) {
			const p = b[from];
			if (!p) continue;
			if (colorOf(p) === by && (typeOf(p) === ROOK || typeOf(p) === QUEEN)) return true;
			break;
		}
	}
	return false;
}

export const inCheck = (pos, color = pos.turn) => isAttacked(pos, pos.kings[color >> 3], other(color));

function pushPawn(list, pos, from, to, flags) {
	const rank = rankOf(to);
	if (rank === 0 || rank === 7) {
		for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
			list.push({ from, to, piece: pos.board[from], captured: pos.board[to] || 0, promotion: promo, flags: flags | PROMO });
		}
	} else {
		list.push({ from, to, piece: pos.board[from], captured: pos.board[to] || 0, promotion: 0, flags });
	}
}

const push = (list, pos, from, to, flags) =>
	list.push({ from, to, piece: pos.board[from], captured: flags & EP ? (PAWN | other(colorOf(pos.board[from]))) : (pos.board[to] || 0), promotion: 0, flags });

// 伪合法走法生成；`legal` 会过滤掉让王被攻击的走法。
export function generateMoves(pos, { legal = true, from: onlyFrom = -1, capturesOnly = false } = {}) {
	const b = pos.board, us = pos.turn, them = other(us), moves = [];
	const first = onlyFrom >= 0 ? onlyFrom : 0;
	const last = onlyFrom >= 0 ? onlyFrom : 119;

	for (let sq = first; sq <= last; sq++) {
		if (!onBoard(sq)) { sq += 7; continue; }
		const piece = b[sq];
		if (!piece || colorOf(piece) !== us) continue;
		const kind = typeOf(piece);

		if (kind === PAWN) {
			const dir = us === WHITE ? -16 : 16;
			const startRank = us === WHITE ? 6 : 1;
			const one = sq + dir;
			if (!capturesOnly && onBoard(one) && !b[one]) {
				pushPawn(moves, pos, sq, one, 0);
				const two = sq + dir * 2;
				if (rankOf(sq) === startRank && !b[two]) push(moves, pos, sq, two, BIGPAWN);
			}
			for (const side of [-1, 1]) {
				const to = one + side;
				if (!onBoard(to)) continue;
				if (b[to] && colorOf(b[to]) === them) pushPawn(moves, pos, sq, to, CAPTURE);
				else if (to === pos.ep) push(moves, pos, sq, to, CAPTURE | EP);
			}
			continue;
		}

		const steps = kind === KNIGHT ? KNIGHT_STEPS
			: kind === KING ? KING_STEPS
			: kind === BISHOP ? DIAGONALS
			: kind === ROOK ? ORTHOGONALS
			: KING_STEPS;
		const sliding = kind === BISHOP || kind === ROOK || kind === QUEEN;

		for (const step of steps) {
			let to = sq + step;
			while (onBoard(to)) {
				const target = b[to];
				if (!target) {
					if (!capturesOnly) push(moves, pos, sq, to, 0);
				} else {
					if (colorOf(target) === them) push(moves, pos, sq, to, CAPTURE);
					break;
				}
				if (!sliding) break;
				to += step;
			}
		}

		if (kind === KING && !capturesOnly) {
			const home = us === WHITE ? 116 : 4;
			if (sq === home && !isAttacked(pos, home, them)) {
				const kRight = us === WHITE ? WK : BK;
				const qRight = us === WHITE ? WQ : BQ;
				if ((pos.castling & kRight) && !b[home + 1] && !b[home + 2] &&
					!isAttacked(pos, home + 1, them) && !isAttacked(pos, home + 2, them)) {
					push(moves, pos, sq, home + 2, KCASTLE);
				}
				if ((pos.castling & qRight) && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
					!isAttacked(pos, home - 1, them) && !isAttacked(pos, home - 2, them)) {
					push(moves, pos, sq, home - 2, QCASTLE);
				}
			}
		}
	}

	if (!legal) return moves;

	const out = [];
	for (const move of moves) {
		const undo = makeMove(pos, move);
		if (!isAttacked(pos, pos.kings[us >> 3], them)) out.push(move);
		unmakeMove(pos, move, undo);
	}
	return out;
}

const ROOK_RIGHTS = { 112: WQ, 119: WK, 0: BQ, 7: BK };

export function makeMove(pos, move) {
	const b = pos.board;
	const us = colorOf(move.piece), them = other(us);
	const undo = { castling: pos.castling, ep: pos.ep, half: pos.half, full: pos.full, captured: 0, capturedSq: -1 };

	if (move.flags & EP) {
		const victim = move.to + (us === WHITE ? 16 : -16);
		undo.captured = b[victim];
		undo.capturedSq = victim;
		b[victim] = 0;
	} else if (b[move.to]) {
		undo.captured = b[move.to];
		undo.capturedSq = move.to;
	}

	b[move.to] = move.promotion ? (move.promotion | us) : move.piece;
	b[move.from] = 0;

	if (typeOf(move.piece) === KING) {
		pos.kings[us >> 3] = move.to;
		pos.castling &= us === WHITE ? ~(WK | WQ) : ~(BK | BQ);
		if (move.flags & KCASTLE) { b[move.to - 1] = b[move.to + 1]; b[move.to + 1] = 0; }
		if (move.flags & QCASTLE) { b[move.to + 1] = b[move.to - 2]; b[move.to - 2] = 0; }
	}
	if (ROOK_RIGHTS[move.from] !== undefined && typeOf(move.piece) === ROOK) pos.castling &= ~ROOK_RIGHTS[move.from];
	if (ROOK_RIGHTS[move.to] !== undefined && undo.captured && typeOf(undo.captured) === ROOK) pos.castling &= ~ROOK_RIGHTS[move.to];

	pos.ep = move.flags & BIGPAWN ? move.from + (us === WHITE ? -16 : 16) : -1;
	pos.half = (undo.captured || typeOf(move.piece) === PAWN) ? 0 : pos.half + 1;
	if (us === BLACK) pos.full++;
	pos.turn = them;
	return undo;
}

export function unmakeMove(pos, move, undo) {
	const b = pos.board, us = colorOf(move.piece);
	b[move.from] = move.piece;
	b[move.to] = 0;
	if (undo.capturedSq >= 0) b[undo.capturedSq] = undo.captured;

	if (typeOf(move.piece) === KING) {
		pos.kings[us >> 3] = move.from;
		if (move.flags & KCASTLE) { b[move.to + 1] = b[move.to - 1]; b[move.to - 1] = 0; }
		if (move.flags & QCASTLE) { b[move.to - 2] = b[move.to + 1]; b[move.to + 1] = 0; }
	}
	pos.castling = undo.castling;
	pos.ep = undo.ep;
	pos.half = undo.half;
	pos.full = undo.full;
	pos.turn = us;
}

export function status(pos) {
	const moves = generateMoves(pos);
	const checked = inCheck(pos);
	if (!moves.length) return checked ? 'checkmate' : 'stalemate';
	if (pos.half >= 100) return 'fifty';
	if (insufficientMaterial(pos)) return 'material';
	return checked ? 'check' : 'play';
}

function insufficientMaterial(pos) {
	const counts = [];
	let bishops = 0, knights = 0, others = 0;
	for (let sq = 0; sq <= 119; sq++) {
		if (!onBoard(sq)) { sq += 7; continue; }
		const p = pos.board[sq];
		if (!p) continue;
		const t = typeOf(p);
		if (t === KING) continue;
		if (t === BISHOP) { bishops++; counts.push((fileOf(sq) + rankOf(sq)) & 1); }
		else if (t === KNIGHT) knights++;
		else others++;
	}
	if (others) return false;
	if (bishops + knights <= 1) return true;
	if (knights === 0 && bishops > 1) return counts.every(c => c === counts[0]);
	return false;
}

// 为一步尚未走出的棋生成 SAN 记谱。
export function sanOf(pos, move) {
	if (move.flags & KCASTLE) return decorate(pos, move, 'O-O');
	if (move.flags & QCASTLE) return decorate(pos, move, 'O-O-O');

	const kind = typeOf(move.piece);
	let text = '';
	if (kind === PAWN) {
		if (move.flags & CAPTURE) text += FILES[fileOf(move.from)] + 'x';
		text += squareName(move.to);
		if (move.promotion) text += '=' + PIECE_LETTER[move.promotion].toUpperCase();
	} else {
		text += PIECE_LETTER[kind].toUpperCase();
		const rivals = generateMoves(pos).filter(m =>
			m.to === move.to && m.from !== move.from && typeOf(m.piece) === kind);
		if (rivals.length) {
			const sameFile = rivals.some(m => fileOf(m.from) === fileOf(move.from));
			const sameRank = rivals.some(m => rankOf(m.from) === rankOf(move.from));
			if (!sameFile) text += FILES[fileOf(move.from)];
			else if (!sameRank) text += String(8 - rankOf(move.from));
			else text += squareName(move.from);
		}
		if (move.flags & CAPTURE) text += 'x';
		text += squareName(move.to);
	}
	return decorate(pos, move, text);
}

function decorate(pos, move, text) {
	const undo = makeMove(pos, move);
	const state = status(pos);
	unmakeMove(pos, move, undo);
	if (state === 'checkmate') return text + '#';
	if (state === 'check') return text + '+';
	return text;
}

export function findMove(pos, from, to, promotion = QUEEN) {
	return generateMoves(pos, { from }).find(m =>
		m.to === to && (!(m.flags & PROMO) || m.promotion === promotion)) || null;
}

export function pieceList(pos) {
	const list = [];
	for (let sq = 0; sq <= 119; sq++) {
		if (!onBoard(sq)) { sq += 7; continue; }
		const p = pos.board[sq];
		if (p) list.push({ sq, type: typeOf(p), color: colorOf(p) });
	}
	return list;
}
