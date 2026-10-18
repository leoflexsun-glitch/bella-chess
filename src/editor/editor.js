// 摆棋编辑器：自由摆放棋子、设定轮到谁走与易位权、校验后从该局面开局。
// 拍照识别的结果也落到这里，由用户核对后再开局。

import { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, START_FEN, fromFen, toFen } from '../chess/engine.js';
import { prepare, possibleCastling, fenSyntaxError } from '../chess/setup.js';
import { createBoard2d } from '../view2d/board.js';

const TYPES = [KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN];
const LETTER = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
const FLAGS = { K: 1, Q: 2, k: 4, q: 8 };
const code = piece => ((piece & 24) === WHITE ? 'w' : 'b') + LETTER[piece & 7];
const $ = (name, root) => root.querySelector(`[data-slot="${name}"]`);

export function createEditor({ settings, onPlay, onPhoto, toast }) {
	const root = document.getElementById('editor');
	const fenInput = root.querySelector('#ed-fen');
	const errorsBox = $('ed-errors', root);
	const playButton = root.querySelector('[data-ed="play"]');

	let board = new Int8Array(128);
	let turn = WHITE;
	let castling = 15;
	let side = WHITE;
	let sideTouched = false;
	let tool = 'move';        // 'move' | 'trash' | 棋子编码（type|color）
	let warn = new Set();     // 识别置信度低、需要用户核对的格子
	let pendingTool = null;   // 按在有子的格上：抬起时才决定是点按还是拖拽
	let open = false;

	const view = createBoard2d(document.getElementById('board-edit'), {
		press(sq) {
			pendingTool = null;
			if (sq < 0) return false;
			if (board[sq]) {
				// 有子的格：先允许拖起；没拖动就在抬起时执行当前工具。
				pendingTool = sq;
				return true;
			}
			if (typeof tool === 'number') { setSquare(sq, tool); }
			return false;
		},
		release(from, to, moved) {
			if (!moved) {
				if (pendingTool === from) applyToolOn(from);
				pendingTool = null;
				return true;
			}
			pendingTool = null;
			const piece = board[from];
			board[from] = 0;
			warn.delete(from);
			if (to >= 0) { board[to] = piece; warn.delete(to); }
			changed();
			return true;
		}
	});

	function applyToolOn(sq) {
		if (tool === 'trash') setSquare(sq, 0);
		else if (typeof tool === 'number') setSquare(sq, board[sq] === tool ? 0 : tool);
	}

	function setSquare(sq, piece) {
		board[sq] = piece;
		warn.delete(sq);
		changed();
	}

	// ── 调色板 ──────────────────────────────────────────────

	function buildPalette() {
		const row = (color, toolName, icon, label) =>
			TYPES.map(t => `<button data-tool="${t | color}" aria-label="${label}"><i class="pc ${code(t | color)}"></i></button>`).join('') +
			`<button data-tool="${toolName}" aria-label="${toolName === 'move' ? '移动' : '删除'}" title="${toolName === 'move' ? '移动棋子' : '删除棋子'}"><svg><use href="#${icon}"/></svg></button>`;
		$('palette-b', root).innerHTML = row(BLACK, 'move', 'i-hand', '黑子');
		$('palette-w', root).innerHTML = row(WHITE, 'trash', 'i-trash', '白子');
		for (const p of root.querySelectorAll('.palette')) p.style.gridTemplateColumns = 'repeat(7, 1fr)';
	}

	function paintPalette() {
		for (const b of root.querySelectorAll('[data-tool]')) b.classList.toggle('on', String(tool) === b.dataset.tool);
		const tip = tool === 'move' ? '拖动棋子移动，拖出棋盘删除；选一个棋子后可点格子放置。'
			: tool === 'trash' ? '点棋子删除。'
				: '点格子放置；点同样的棋子取消。也可以直接把棋子拖进棋盘。';
		$('ed-tip', root).textContent = tip;
	}

	// 调色板里的棋子既能点选为工具，也能直接拖到棋盘上。
	let ghost = null;
	root.addEventListener('pointerdown', event => {
		const button = event.target.closest('.palette [data-tool]');
		if (!button) return;
		const value = button.dataset.tool;
		tool = /^\d+$/.test(value) ? Number(value) : value;
		paintPalette();
		if (typeof tool !== 'number') return;
		event.preventDefault();
		const piece = tool;
		const start = { x: event.clientX, y: event.clientY };
		const move = e => {
			if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
			if (!ghost) {
				ghost = document.createElement('i');
				ghost.className = `pc drag-ghost ${code(piece)}`;
				const size = view.el.getBoundingClientRect().width / 8;
				ghost.style.width = ghost.style.height = `${size}px`;
				document.body.append(ghost);
			}
			ghost.style.left = `${e.clientX}px`;
			ghost.style.top = `${e.clientY}px`;
		};
		const up = e => {
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', up);
			removeEventListener('pointercancel', up);
			if (!ghost) return;
			ghost.remove();
			ghost = null;
			const sq = view.squareAt(e.clientX, e.clientY);
			if (sq >= 0 && e.type === 'pointerup') setSquare(sq, piece);
		};
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
		addEventListener('pointercancel', up);
	});

	// ── 局面 ⇄ 界面 ─────────────────────────────────────────

	const currentFen = () => toFen({ board, turn, castling, ep: -1, half: 0, full: 1 });

	function changed() {
		// 易位权跟随摆法：不可能的去掉并禁用；重新变得可能时默认勾上。
		const possible = possibleCastling({ board });
		for (const [flag, bit] of Object.entries(FLAGS)) {
			const box = root.querySelector(`[data-slot="castling"] input[value="${flag}"]`);
			if (!possible[flag]) castling &= ~bit;
			else if (box.disabled) castling |= bit;
			box.disabled = !possible[flag];
			box.checked = Boolean(castling & bit);
			box.parentElement.classList.toggle('off', !possible[flag]);
		}
		view.setPosition(board);
		view.setMarks({ warn: [...warn] });
		paintSegs();
		const fen = currentFen();
		if (document.activeElement !== fenInput) fenInput.value = fen;
		const { errors } = prepare(fen);
		errorsBox.innerHTML = errors.map(e => `<li>${e}</li>`).join('');
		playButton.disabled = errors.length > 0;
	}

	function paintSegs() {
		for (const seg of root.querySelectorAll('[data-ed-set]')) {
			const value = seg.dataset.edSet === 'turn' ? (turn === WHITE ? 'w' : 'b') : (side === WHITE ? 'w' : 'b');
			for (const b of seg.querySelectorAll('[data-value]')) b.classList.toggle('on', b.dataset.value === value);
		}
	}

	function load(fen, { keepWarn = false } = {}) {
		const pos = fromFen(fen);
		board = Int8Array.from(pos.board);
		turn = pos.turn;
		castling = pos.castling;
		if (!sideTouched) side = turn;
		if (!keepWarn) warn = new Set();
		changed();
	}

	root.addEventListener('click', event => {
		const seg = event.target.closest('[data-ed-set] [data-value]');
		if (seg) {
			const color = seg.dataset.value === 'b' ? BLACK : WHITE;
			if (seg.parentElement.dataset.edSet === 'turn') { turn = color; if (!sideTouched) side = color; }
			else { side = color; sideTouched = true; }
			changed();
			return;
		}
		const action = event.target.closest('[data-ed]')?.dataset.ed;
		if (!action) return;
		if (action === 'close') close();
		else if (action === 'photo') onPhoto();
		else if (action === 'start-pos') load(START_FEN);
		else if (action === 'clear') { board = new Int8Array(128); warn = new Set(); changed(); }
		else if (action === 'flip') { view.setFlipped(!view.flipped); }
		else if (action === 'copy-fen') {
			navigator.clipboard?.writeText(currentFen()).then(() => toast('FEN 已复制'), () => toast('剪贴板不可用'));
		}
		else if (action === 'play') {
			const { fen, errors } = prepare(currentFen());
			if (errors.length) { toast(errors[0]); return; }
			close();
			onPlay({ fen, human: side, level: settings.level });
		}
	});

	root.querySelector('[data-slot="castling"]').addEventListener('change', event => {
		const bit = FLAGS[event.target.value];
		if (event.target.checked) castling |= bit; else castling &= ~bit;
		changed();
	});

	// 粘贴/输入 FEN：语法对就载入，不对就提示哪里错。
	const applyFenInput = () => {
		const text = fenInput.value.trim();
		if (!text || text === currentFen()) return;
		const error = fenSyntaxError(text);
		if (error) { errorsBox.innerHTML = `<li>FEN：${error}</li>`; playButton.disabled = true; return; }
		load(text);
	};
	fenInput.addEventListener('change', applyFenInput);
	fenInput.addEventListener('keydown', event => { if (event.key === 'Enter') { applyFenInput(); fenInput.blur(); } });

	function close() {
		open = false;
		root.hidden = true;
	}

	addEventListener('keydown', event => {
		// 拍照页叠在编辑器上面时，Esc 只关拍照页。
		if (open && event.key === 'Escape' && !document.querySelector('dialog[open]') && document.getElementById('photo').hidden) close();
	});

	buildPalette();

	return {
		get isOpen() { return open; },
		// pos：从当前对局局面开始摆；result：拍照识别结果 { placement, flipped, warn }。
		open(pos, result) {
			open = true;
			root.hidden = false;
			sideTouched = false;
			tool = 'move';
			paintPalette();
			if (result) {
				load(`${result.placement} w - - 0 1`);
				// 易位权：王车在原位就默认给上（棋图上看不出是否走动过）。
				castling = 15;
				warn = new Set(result.warn || []);
				view.setFlipped(Boolean(result.flipped));
				changed();
				toast('识别完成：请核对棋子，并确认轮到哪一方走', 4200);
			} else {
				view.setFlipped(false);
				load(pos ? toFen(pos) : START_FEN);
			}
		}
	};
}
