// 2D 棋盘：纯 DOM + CSS 背景棋子，与 three.js 无关。
// 只负责"画"和"把指针动作翻译成意图"，走子规则、选中逻辑都在调用方。
//
// 意图（intents）：
//   press(sq)                → 指针按下某格（-1 表示盘外）。返回 true 表示允许从这格拖起棋子。
//   release(from, to, moved) → 指针抬起。moved=false 是原地点按；moved=true 是拖拽落下
//                              （to=-1 表示拖出棋盘）。返回 true 表示接受（不弹回）。
//
// 格子编号沿用引擎的 0x88：a8 = 0，h1 = 119。

import { WHITE, KING, QUEEN, ROOK, BISHOP, KNIGHT, KCASTLE, QCASTLE, EP, typeOf, colorOf } from '../chess/engine.js';
import { pairPieces } from './pairing.js';

const LETTER = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
export const pieceCode = piece => (colorOf(piece) === WHITE ? 'w' : 'b') + LETTER[typeOf(piece)];

const ANIM_MS = 190;
const FILES = 'abcdefgh';

export function createBoard2d(host, intents = {}) {
	const root = document.createElement('div');
	root.className = 'b2d';
	root.setAttribute('role', 'img');
	root.setAttribute('aria-label', '棋盘');
	// 外层是边框（坐标写在边框上），内层网格才是 8×8 棋格；所有坐标换算都以网格为准。
	// 图层自下而上：标记 → 特效 → 提示箭头 → 棋子 → 升变选择。
	// 特效与箭头一律压在棋子下面：任何动效都不能遮挡或改变棋子的样子。
	root.innerHTML = '<div class="b2d-coords"></div><div class="b2d-grid"><div class="b2d-marks"></div><div class="b2d-fx"></div>' +
		'<svg class="b2d-arrows" viewBox="0 0 8 8" aria-hidden="true"></svg><div class="b2d-pieces"></div><div class="b2d-promo" hidden></div></div>';
	host.append(root);

	const grid = root.querySelector('.b2d-grid');

	const marksLayer = root.querySelector('.b2d-marks');
	const coordsLayer = root.querySelector('.b2d-coords');
	const piecesLayer = root.querySelector('.b2d-pieces');
	const promoLayer = root.querySelector('.b2d-promo');
	const arrowLayer = root.querySelector('.b2d-arrows');
	const fxLayer = root.querySelector('.b2d-fx');

	let flipped = false;
	let pieces = new Map();       // sq -> 元素
	let board = new Int8Array(128);
	let marks = {};
	let animating = 0;
	let settleTimer = 0;
	let drag = null;
	let hoverSq = -1;
	let promoFinish = null;
	let stale = false;           // 动画落定时玩家正拖着子：对账推迟到放手后

	const xy = sq => {
		const f = sq & 15, r = sq >> 4;
		return flipped ? [7 - f, 7 - r] : [f, r];
	};

	function place(el, sq) {
		const [x, y] = xy(sq);
		el.style.setProperty('--x', x);
		el.style.setProperty('--y', y);
	}

	function makePiece(piece, sq) {
		const el = document.createElement('i');
		el.className = `pc ${pieceCode(piece)}`;
		el.dataset.p = pieceCode(piece);
		place(el, sq);
		return el;
	}

	// 整盘重建（无动画）。悔棋、换局、切视图、动画结束对账都走这里，结果只取决于 board。
	function render() {
		stale = false;
		cancelDrag();
		const next = new Map();
		const frag = document.createDocumentFragment();
		for (let sq = 0; sq < 128; sq++) {
			if (sq & 0x88 || !board[sq]) continue;
			const el = makePiece(board[sq], sq);
			next.set(sq, el);
			frag.append(el);
		}
		piecesLayer.replaceChildren(frag);
		pieces = next;
	}

	function renderCoords() {
		let html = '';
		for (let i = 0; i < 8; i++) {
			// 底边框写文件字母，左边框写行号，各自对准所在的列/行中心。
			const file = flipped ? FILES[7 - i] : FILES[i];
			const rank = flipped ? i + 1 : 8 - i;
			html += `<span class="cf" style="--x:${i}">${file}</span><span class="cr" style="--y:${i}">${rank}</span>`;
		}
		coordsLayer.innerHTML = html;
	}

	function renderMarks() {
		const out = [];
		const add = (sq, cls) => {
			if (sq == null || sq < 0) return;
			const [x, y] = xy(sq);
			out.push(`<i class="mk ${cls}" style="--x:${x};--y:${y}"></i>`);
		};
		if (marks.lastMove) { add(marks.lastMove.from, 'last'); add(marks.lastMove.to, 'last'); }
		if (marks.result) { add(marks.result.win, 'win'); add(marks.result.lose, 'lose'); for (const sq of marks.result.draw || []) add(sq, 'draw'); }
		add(marks.selected, 'sel');
		for (const sq of marks.warn || []) add(sq, 'warn');
		add(marks.check, 'check');
		for (const t of marks.targets || []) add(t.sq, t.capture ? 'cap' : 'dot');
		add(hoverSq, 'hover');
		// 箭头在棋子下面，吃子提示的箭头头部会被目标棋子挡住；起止格再各加一圈贴边绿框，方向一眼可读。
		if (marks.arrow) { add(marks.arrow.from, 'hint-from'); add(marks.arrow.to, 'hint-to'); }
		marksLayer.innerHTML = out.join('');
		renderArrow(marks.arrow);
	}

	// 提示箭头：格心到格心，箭头尖停在目标格中心稍前。
	function renderArrow(arrow) {
		if (!arrow) { arrowLayer.innerHTML = ''; return; }
		const [x1, y1] = xy(arrow.from).map(v => v + 0.5);
		const [x2, y2] = xy(arrow.to).map(v => v + 0.5);
		const len = Math.hypot(x2 - x1, y2 - y1);
		const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
		const head = 0.42, tipX = x2 - ux * 0.08, tipY = y2 - uy * 0.08;
		const baseX = tipX - ux * head, baseY = tipY - uy * head;
		const nx = -uy * 0.26, ny = ux * 0.26;
		arrowLayer.innerHTML =
			`<line x1="${x1}" y1="${y1}" x2="${baseX}" y2="${baseY}"/>` +
			`<polygon points="${tipX},${tipY} ${baseX + nx},${baseY + ny} ${baseX - nx},${baseY - ny}"/>`;
	}

	// 一次性特效（吃子波纹、将军脉冲、胜利底光），画在特效层，播完自删。
	function pulse(sq, kind) {
		if (sq == null || sq < 0) return;
		const el = document.createElement('i');
		el.className = `fx fx-${kind}`;
		el.dataset.sq = sq;          // 翻转棋盘时据此重新定位
		place(el, sq);
		fxLayer.append(el);
		const done = () => el.remove();
		el.addEventListener('animationend', done, { once: true });
		setTimeout(done, 4000);   // 兜底（如后台标签页不触发动画事件）；须长于最长的特效（胜利金光 2.8 秒）
	}

	// 平滑过渡到任意局面（悔棋、复盘浏览）：同位同子不动；同种棋子就近滑过去（配对见 pairing.js）；
	// 多出的淡出、缺的淡入。全程棋子形状不变，只是移动。
	function animateTo(next) {
		cancelDrag();
		clearTimeout(settleTimer);
		board = Int8Array.from(next.board ?? next);
		const left = new Map(pieces);
		const nextMap = new Map();
		const need = [];
		for (let sq = 0; sq < 128; sq++) {
			if (sq & 0x88 || !board[sq]) continue;
			const code = pieceCode(board[sq]);
			const el = left.get(sq);
			if (el && el.dataset.p === code) {
				// 原位不动的也重新定位一次：升变待选时兵画在底线，但记录仍在原格。
				place(el, sq);
				nextMap.set(sq, el);
				left.delete(sq);
			} else need.push({ sq, code });
		}
		const { moves, appear, vanish } = pairPieces([...left].map(([sq, el]) => ({ sq, code: el.dataset.p })), need);
		for (const [from, to] of moves) {
			const el = left.get(from);
			place(el, to);
			el.classList.add('moving');
			nextMap.set(to, el);
		}
		for (const sq of appear) {
			const el = makePiece(board[sq], sq);
			el.classList.add('appear');
			piecesLayer.append(el);
			nextMap.set(sq, el);
		}
		for (const sq of vanish) left.get(sq).classList.add('gone');
		pieces = nextMap;
		settle();
	}

	function settle(after) {
		clearTimeout(settleTimer);
		animating++;
		settleTimer = setTimeout(() => {
			animating = 0;
			// 动画只是视觉；落定后无条件按真实局面重建一次，任何竞态都留不下残子。
			// 玩家正拖着子就先不重建（重建会打断拖拽），放手后补上。
			if (drag) stale = true; else render();
			after?.();
		}, ANIM_MS + 40);
	}

	// ── 指针 ────────────────────────────────────────────────

	function squareAt(clientX, clientY) {
		const rect = grid.getBoundingClientRect();
		const x = Math.floor((clientX - rect.left) / rect.width * 8);
		const y = Math.floor((clientY - rect.top) / rect.height * 8);
		if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
		const f = flipped ? 7 - x : x, r = flipped ? 7 - y : y;
		return r * 16 + f;
	}

	function dragTo(clientX, clientY) {
		const rect = grid.getBoundingClientRect();
		const size = rect.width / 8;
		const x = clientX - rect.left - size / 2;
		const y = clientY - rect.top - size / 2;
		drag.el.style.transform = `translate(${x}px, ${y}px) scale(1.12)`;
		const over = squareAt(clientX, clientY);
		if (over !== hoverSq) { hoverSq = over; renderMarks(); }
	}

	function cancelDrag() {
		if (!drag) return;
		drag.el.classList.remove('drag');
		drag.el.style.transform = '';
		drag = null;
		if (hoverSq >= 0) { hoverSq = -1; renderMarks(); }
	}

	root.addEventListener('pointerdown', event => {
		if (event.button > 0 || !promoLayer.hidden) return;
		const sq = squareAt(event.clientX, event.clientY);
		const canDrag = intents.press?.(sq) ?? false;
		const el = pieces.get(sq);
		if (!canDrag || !el) return;
		event.preventDefault();
		root.setPointerCapture(event.pointerId);
		drag = { from: sq, el, x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
	});

	root.addEventListener('pointermove', event => {
		if (!drag || event.pointerId !== drag.id) return;
		if (!drag.moved) {
			const size = grid.getBoundingClientRect().width / 8;
			if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < Math.max(4, size * 0.12)) return;
			drag.moved = true;
			drag.el.classList.add('drag');
		}
		dragTo(event.clientX, event.clientY);
	});

	function endDrag(event, cancelled) {
		if (!drag || event.pointerId !== drag.id) return;
		const { from, el, moved } = drag;
		const to = cancelled ? -1 : squareAt(event.clientX, event.clientY);
		drag = null;
		hoverSq = -1;
		const accepted = !cancelled && (moved ? to !== from : true) && (intents.release?.(from, to, moved) ?? false);
		if (moved && accepted && el.isConnected && el.classList.contains('drag')) {
			// 接受了但调用方还没动棋子（例如在等升变选择）：先让它停在目标格。
			el.classList.add('snap');
			el.classList.remove('drag');
			el.style.transform = '';
			if (to >= 0) place(el, to);
			requestAnimationFrame(() => el.classList.remove('snap'));
		} else if (el.classList.contains('drag')) {
			// 没被接受：弹回原格（transition 负责动画）。
			el.classList.remove('drag');
			el.style.transform = '';
		}
		renderMarks();
		// 补上拖动期间推迟的对账；若已开始新动画或在等升变选择，由它们收尾。
		if (stale && animating === 0 && promoLayer.hidden) render();
	}

	root.addEventListener('pointerup', event => endDrag(event, false));
	root.addEventListener('pointercancel', event => endDrag(event, true));
	root.addEventListener('contextmenu', event => event.preventDefault());

	// ── 升变选择：在目标格所在列竖排四个候选 ─────────────────

	function askPromotion(to, color) {
		return new Promise(resolve => {
			const [x, y] = xy(to);
			const down = y === 0;  // 目标在上沿就往下排，在下沿就往上排
			const prefix = color === WHITE ? 'w' : 'b';
			const choices = [QUEEN, KNIGHT, ROOK, BISHOP];
			promoLayer.innerHTML = choices.map((type, i) =>
				`<button class="promo-choice" data-type="${type}" style="--x:${x};--y:${down ? i : 7 - i}" aria-label="升变">` +
				`<i class="pc ${prefix}${LETTER[type]}"></i></button>`).join('');
			promoLayer.hidden = false;
			const finish = type => {
				promoFinish = null;
				promoLayer.hidden = true;
				promoLayer.innerHTML = '';
				promoLayer.removeEventListener('pointerdown', onPick);
				resolve(type);
			};
			promoFinish = finish;
			const onPick = event => {
				event.stopPropagation();
				event.preventDefault();
				const button = event.target.closest('[data-type]');
				finish(button ? Number(button.dataset.type) : null);
			};
			promoLayer.addEventListener('pointerdown', onPick);
		});
	}

	renderCoords();

	return {
		el: root,
		squareAt,
		squareSize: () => grid.getBoundingClientRect().width / 8,

		// 摆到某局面（board 为 0x88 数组或带 board 字段的局面）；animate 时棋子平滑滑过去。
		setPosition(next, { animate = false } = {}) {
			fxLayer.replaceChildren();   // 一次性特效属于旧局面，换局面就收掉
			if (animate && pieces.size) { animateTo(next); return; }
			board = Int8Array.from(next.board ?? next);
			clearTimeout(settleTimer);
			animating = 0;
			render();
		},
		pulse,

		// 播放一步棋；after 为走完后的局面，动画落定后据此对账。
		playMove(move, after) {
			board = Int8Array.from(after.board ?? after);
			const el = pieces.get(move.from);
			if (!el) { render(); return; }

			const victimSq = move.flags & EP ? move.to + (colorOf(move.piece) === WHITE ? 16 : -16) : move.to;
			const victim = pieces.get(victimSq);
			if (victim && victim !== el) {
				victim.classList.add('gone');
				pieces.delete(victimSq);
				pulse(victimSq, 'capture');
			}

			const wasDragged = el.classList.contains('drag');
			if (wasDragged) {
				// 拖拽落子：棋子已在手里到了目标格，直接定位，不再从起点飞过去。
				el.classList.add('snap');
				el.classList.remove('drag');
				el.style.transform = '';
				drag = null;
				requestAnimationFrame(() => el.classList.remove('snap'));
			}
			pieces.delete(move.from);
			pieces.set(move.to, el);
			place(el, move.to);
			el.classList.add('moving');

			if (typeOf(move.piece) === KING && move.flags & (KCASTLE | QCASTLE)) {
				const [rf, rt] = move.flags & KCASTLE ? [move.to + 1, move.to - 1] : [move.to - 2, move.to + 1];
				const rook = pieces.get(rf);
				if (rook) { pieces.delete(rf); pieces.set(rt, rook); place(rook, rt); rook.classList.add('moving'); }
			}
			if (move.promotion) {
				const code = pieceCode(move.promotion | colorOf(move.piece));
				el.className = `pc moving ${code}`;
				el.dataset.p = code;
			}
			settle();
		},

		// marks: { lastMove, selected, targets: [{ sq, capture }], check, warn: [sq] }
		setMarks(next) { marks = next || {}; renderMarks(); },

		setFlipped(on) {
			if (flipped === on) return;
			flipped = on;
			for (const el of fxLayer.children) place(el, Number(el.dataset.sq));   // 特效跟着自己的格子走
			renderCoords();
			render();
			renderMarks();
		},
		get flipped() { return flipped; },

		askPromotion,
		cancelPromotion() { promoFinish?.(null); },
		isIdle: () => animating === 0 && !drag,
		get dragging() { return Boolean(drag); }
	};
}
