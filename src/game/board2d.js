import { WHITE, typeOf, colorOf } from '../chess/engine.js';

// 二维棋盘：同一局棋的另一双眼睛。DOM 渲染，Unicode 棋形，
// 与 3D 场景共享 match 状态，这里只管画和把点击翻译成格号。

const GLYPH = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };
const FILES = 'abcdefgh';

export function createBoard2D(container, { onSquare }) {
	container.classList.add('b2d');
	const cells = [];

	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			const cell = document.createElement('div');
			cell.className = `sq ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
			const coord = document.createElement('span');
			coord.className = 'coord';
			const glyph = document.createElement('span');
			glyph.className = 'glyph';
			cell.append(coord, glyph);
			container.append(cell);
			cells.push(cell);
		}
	}

	container.addEventListener('click', event => {
		const cell = event.target.closest('.sq');
		if (!cell || cell.dataset.sq === undefined) return;
		onSquare(Number(cell.dataset.sq));
	});

	function squareAt(row, col, flipped) {
		// 不翻转：顶行是第 8 横排（r=0），左列是 a 线。
		const r = flipped ? 7 - row : row;
		const f = flipped ? 7 - col : col;
		return r * 16 + f;
	}

	function render({ pos, selected = -1, legal = [], lastMove = null, checkSq = -1, flipped = false }) {
		const targets = new Map();
		for (const move of legal) targets.set(move.to, move.captured ? 'cap' : 'dot');

		for (let row = 0; row < 8; row++) {
			for (let col = 0; col < 8; col++) {
				const cell = cells[row * 8 + col];
				const sq = squareAt(row, col, flipped);
				cell.dataset.sq = sq;

				const piece = pos.board[sq];
				const glyph = cell.lastChild;
				if (piece) {
					glyph.textContent = GLYPH[typeOf(piece)];
					glyph.className = `glyph ${colorOf(piece) === WHITE ? 'pw' : 'pb'}`;
				} else {
					glyph.textContent = '';
					glyph.className = 'glyph';
				}

				// 坐标：左列标横排号，底行标线名。
				const coord = cell.firstChild;
				const leftEdge = col === 0;
				const bottomEdge = row === 7;
				const r = sq >> 4, f = sq & 15;
				coord.textContent = leftEdge ? String(8 - r) : bottomEdge ? FILES[f] : '';

				cell.classList.toggle('sel', sq === selected);
				cell.classList.toggle('last', Boolean(lastMove) && (sq === lastMove.from || sq === lastMove.to));
				cell.classList.toggle('chk', sq === checkSq);
				cell.classList.toggle('dot', targets.get(sq) === 'dot');
				cell.classList.toggle('cap', targets.get(sq) === 'cap');
			}
		}
	}

	return { render };
}
