// 控制器：对局流程、选子与走子、设置、视图切换。
// 视图（2D 棋盘 / 3D 雪林）只负责显示与把指针动作翻译成意图，二者接口一致、可随时互换。

import { WHITE, BLACK, CAPTURE, fromFen, inCheck, colorOf, sanOf, START_FEN } from './chess/engine.js';
import { balance } from './chess/material.js';
import { createMatch } from './game/match.js';
import { createBoard2d } from './view2d/board.js';
import { createView3d } from './view3d/view3d.js';
import { createShell } from './ui/shell.js';
import { loadSettings, saveSettings, saveGame, loadGame } from './ui/settings.js';
import { createAudio } from './core/audio.js';
import { createEditor } from './editor/editor.js';
import { createPhoto } from './editor/photo.js';

const SIDE = { [WHITE]: '白方', [BLACK]: '黑方' };
const LEVEL_TEXT = { novice: '新手', club: '棋社', expert: '专家', master: '大师' };
const REASON_TEXT = {
	checkmate: '将杀',
	resignation: '认输',
	stalemate: '逼和',
	'fifty-move rule': '五十回合规则',
	'insufficient material': '子力不足',
	'threefold repetition': '三次重复局面'
};

const settings = loadSettings();
const audio = createAudio();
audio.enabled = settings.sound === 'on';
const body = document.body;

// ── 状态 ────────────────────────────────────────────────────────

let playing = false;      // 有一局正在进行（或刚结束、可悔棋）
let selected = -1;
let legal = [];
let pendingDeselect = false;
let promoting = false;
let reviewPly = null;      // 正在查看的历史半步；null = 当前局面
let flipped = false;
let resignArmed = 0;
let hintArrow = null;      // 电脑给出的提示着法 { from, to }，走子或悔棋后清除

const shell = createShell({ onAction: handleAction, onSetting: changeSetting, onMoveClick: reviewTo });

// ── 视图 ────────────────────────────────────────────────────────

const intents = {
	active: () => canMove(),
	press: pressSquare,
	release: releaseSquare
};

const board2d = createBoard2d(document.getElementById('board2d'), intents);
const view2d = {
	kind: '2d',
	show(pos) { board2d.setPosition(pos); },
	hide() { board2d.cancelPromotion(); },
	setPosition: pos => board2d.setPosition(pos),
	playMove: (move, after) => board2d.playMove(move, after),
	setMarks: marks => board2d.setMarks(marks),
	setFlipped: on => board2d.setFlipped(on),
	askPromotion: (to, color) => board2d.askPromotion(to, color),
	isIdle: () => board2d.isIdle()
};
const view3d = createView3d({
	canvas: document.getElementById('stage'),
	settings,
	intents,
	askPromotion: color => shell.askPromotion(color),
	onQualityDrop: next => shell.toast(`画质已自动降到${{ ultra: '极致', high: '高', low: '低' }[next]}，以保持流畅`, 3600)
});
let view = view2d;

// ── 对局 ────────────────────────────────────────────────────────

const match = createMatch({
	onReset: () => {
		clearSelection();
		hintArrow = null;
		reviewPly = null;
		view.setPosition(match.state.pos);
		refresh();
	},
	onTurn: (color, check) => {
		if (check) audio.check();
		refresh();
	},
	onMove: (move, { mover, captured }) => {
		hintArrow = null;
		if (reviewPly === null) view.playMove(move, match.state.pos);
		if (captured) audio.capture(); else audio.place();
		if (mover !== match.state.human) clearSelection();
		refresh();
	},
	onThink: () => refresh(),
	onEnd: over => {
		clearSelection();
		const won = over.winner === match.state.human;
		audio.end(won);
		refresh();
	},
	onError: message => shell.toast(message)
});

function canMove() {
	const s = match.state;
	return playing && !s.over && !s.thinking && s.pos.turn === s.human && reviewPly === null && !promoting;
}

function currentPos() {
	return reviewPly === null ? match.state.pos : fromFen(match.fenAfter(reviewPly));
}

// ── 刷新界面 ──────────────────────────────────────────────────────

function refresh() {
	const s = match.state;
	const pos = currentPos();

	// 棋盘标记
	const lastMove = reviewPly === null ? s.lastMove : (reviewPly >= 0 ? s.history[reviewPly].move : null);
	const checked = inCheck(pos) ? pos.kings[pos.turn >> 3] : -1;
	view.setMarks({
		lastMove,
		selected,
		targets: settings.hints === 'on' ? legal.map(m => ({ sq: m.to, capture: Boolean(m.flags & CAPTURE) })) : [],
		check: checked,
		arrow: reviewPly === null ? hintArrow : null
	});

	// 玩家栏：下方是靠近自己的一侧
	const bal = balance(pos);
	const player = color => {
		const human = playing && color === s.human;
		return {
			color,
			name: !playing ? SIDE[color] : human ? '你' : '电脑',
			sub: !playing ? '' : human ? SIDE[color] : `${SIDE[color]} · ${LEVEL_TEXT[s.level]}`,
			extra: bal[color].extra,
			score: bal[color].score,
			thinking: playing && s.thinking && !human && reviewPly === null,
			turn: playing && !s.over && pos.turn === color && reviewPly === null
		};
	};
	const bottom = flipped ? BLACK : WHITE;
	shell.setPlayers(player(bottom === WHITE ? BLACK : WHITE), player(bottom));

	// 状态行
	if (!playing) shell.setStatus('选择对局方式开始');
	else if (s.over) shell.setStatus(resultText(s.over).title);
	else if (reviewPly !== null) shell.setStatus('正在复盘');
	else if (s.thinking) shell.setStatus('电脑思考中…');
	else if (s.pos.turn === s.human) shell.setStatus(checked >= 0 ? '将军！轮到你走' : '轮到你走', { check: checked >= 0 });
	else shell.setStatus(`轮到${SIDE[s.pos.turn]}`);

	shell.setEval(s.eval);
	shell.setMoves(s.history, reviewPly === null ? s.history.length - 1 : reviewPly);
	shell.setReview(reviewPly === null ? null
		: reviewPly < 0 ? `起始局面 · 共 ${s.history.length} 步` : `第 ${reviewPly + 1} / ${s.history.length} 步`);
	shell.setResult(playing && s.over ? resultText(s.over) : null);

	shell.setControl('undo', { disabled: !playing || !s.history.some(h => h.mover === s.human) });
	shell.setControl('resign', { disabled: !playing || Boolean(s.over) });
	shell.setControl('copy', { disabled: !s.history.length && s.startFen === START_FEN });
	shell.setControl('hint', { disabled: !canMove() });

	persist();
}

function resultText(over) {
	const s = match.state;
	const reason = REASON_TEXT[over.reason] || over.reason;
	if (!over.winner) return { title: '和棋', sub: reason };
	const won = over.winner === s.human;
	return { title: won ? '你赢了！' : '你输了', sub: `${SIDE[over.winner]}胜 · ${reason}` };
}

function persist() {
	const s = match.state;
	if (!playing || s.over) { saveGame(null); return; }
	saveGame({ fen: s.startFen, moves: match.moves(), human: s.human, level: s.level, flipped });
}

// ── 选子与走子（两个视图共用） ───────────────────────────────────

function clearSelection() {
	selected = -1;
	legal = [];
	pendingDeselect = false;
}

function select(sq) {
	selected = sq;
	legal = match.movesFrom(sq);
	pendingDeselect = false;
	if (legal.length) audio.lift(); else audio.deny();
	refresh();
}

function pressSquare(sq) {
	if (!canMove()) {
		if (playing && reviewPly !== null) shell.toast('正在复盘 · 点「回到当前」继续下棋');
		return false;
	}
	if (sq < 0) { clearSelection(); refresh(); return false; }
	if (selected >= 0 && sq !== selected && legal.some(m => m.to === sq)) {
		attempt(selected, sq);
		return false;
	}
	const piece = match.state.pos.board[sq];
	if (piece && colorOf(piece) === match.state.human) {
		if (sq === selected) { pendingDeselect = true; return legal.length > 0; }
		select(sq);
		return legal.length > 0;
	}
	clearSelection();
	refresh();
	return false;
}

function releaseSquare(from, to, moved) {
	if (!moved) {
		if (pendingDeselect && from === selected) { clearSelection(); refresh(); }
		pendingDeselect = false;
		return true;
	}
	pendingDeselect = false;
	if (from !== selected || !legal.some(m => m.to === to)) return false;
	return attempt(from, to);
}

function attempt(from, to) {
	const options = legal.filter(m => m.to === to);
	if (!options.length) return false;
	const color = match.state.human;
	clearSelection();
	if (options.length > 1 && options[0].promotion) {
		promoting = true;
		refresh();
		view.askPromotion(to, color).then(type => {
			promoting = false;
			if (type) match.play(from, to, type);
			else { view.setPosition(match.state.pos); refresh(); }
		});
		return true;
	}
	match.play(from, to);
	return true;
}

// ── 流程 ─────────────────────────────────────────────────────────

function startGame({ human, level = settings.level, fen = START_FEN }) {
	playing = true;
	flipped = human === BLACK;
	view.setFlipped(flipped);
	shell.close('dlg-new');
	match.newGame({ human, level, fen });
}

function resolveSide(side) {
	if (side === 'random') return Math.random() < 0.5 ? WHITE : BLACK;
	return side === 'b' ? BLACK : WHITE;
}

function takeBack() {
	if (!playing) return;
	reviewPly = null;
	view.setPosition(match.state.pos);
	if (promoting) { board2d.cancelPromotion(); shell.close('dlg-promo'); }
	if (match.undo(1)) shell.toast('已悔棋', 1200);
	else { audio.deny(); shell.toast('没有可以悔的棋'); }
}

function reviewTo(ply) {
	const s = match.state;
	if (!s.history.length) return;
	const next = Math.max(-1, Math.min(s.history.length - 1, ply));
	clearSelection();
	reviewPly = next === s.history.length - 1 ? null : next;
	view.setPosition(currentPos());
	refresh();
}

function askHint() {
	if (!canMove()) { audio.deny(); return; }
	const pos = match.state.pos;
	const asked = match.suggest(move => {
		if (!move) return;
		hintArrow = { from: move.from, to: move.to };
		shell.toast(`提示：${sanOf(pos, move)}`, 2600);
		refresh();
	});
	if (asked) shell.toast('正在替你想一步…', 1400);
}

function flip() {
	flipped = !flipped;
	view.setFlipped(flipped);
	refresh();
}

function copyText(text, done) {
	const fallback = () => {
		const area = Object.assign(document.createElement('textarea'), { value: text });
		document.body.append(area);
		area.select();
		const ok = document.execCommand?.('copy');
		area.remove();
		shell.toast(ok ? done : '复制失败，请手动选择复制');
	};
	if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => shell.toast(done), fallback);
	else fallback();
}

function setView(next) {
	const target = next === '3d' ? view3d : view2d;
	if (target === view) return;
	const apply = () => {
		board2d.cancelPromotion();
		view.hide();
		body.dataset.view = next;
		view = target;
		view.show(currentPos());
		view.setFlipped(flipped);
		refresh();
	};
	// 首次搭建 3D 场景要一两秒：先让提示画出来再建。其余切换立即生效。
	if (next === '3d' && !view3d.built) { shell.toast('正在搭建 3D 雪林…', 1800); setTimeout(apply, 60); }
	else apply();
}

// ── 动作与设置 ───────────────────────────────────────────────────

function handleAction(act) {
	switch (act) {
		case 'new': shell.open('dlg-new'); break;
		case 'start': startGame({ human: resolveSide(settings.side) }); break;
		case 'settings': shell.open('dlg-settings'); break;
		case 'setup': shell.close('dlg-new'); editor.open(playing ? match.state.pos : null); break;
		case 'photo': shell.close('dlg-new'); photo.open(); break;
		case 'rematch': startGame({ human: match.state.human, level: match.state.level, fen: match.state.startFen }); break;
		case 'takeback':
		case 'undo': takeBack(); break;
		case 'flip': flip(); break;
		case 'hint': askHint(); break;
		case 'copy': copyText(match.pgn(), '棋谱已复制（PGN）'); break;
		case 'resign':
			if (!playing || match.state.over) break;
			if (Date.now() - resignArmed < 3000) { resignArmed = 0; match.resign(); }
			else { resignArmed = Date.now(); shell.toast('再按一次「认输」确认', 3000); }
			break;
		case 'review-prev': reviewTo((reviewPly ?? match.state.history.length - 1) - 1); break;
		case 'review-next': reviewTo((reviewPly ?? match.state.history.length - 1) + 1); break;
		case 'review-exit': reviewTo(match.state.history.length - 1); break;
	}
}

function changeSetting(key, value) {
	if (settings[key] === value) return;
	settings[key] = value;
	saveSettings(settings);
	applySetting(key);
	shell.paintSettings(settings);
}

function applySetting(key) {
	const v = settings[key];
	if (key === 'board' || key === 'pieces' || key === 'coords') body.dataset[key] = v;
	else if (key === 'sound') audio.enabled = v === 'on';
	else if (key === 'hints') refresh();
	else if (key === 'view') setView(v);
	else if (key === 'quality') view3d.setQuality(v);
	else if (key === 'snow') view3d.setSnow(v);
	else if (key === 'badges') view3d.setBadges(v === 'on');
}

// ── 键盘 ─────────────────────────────────────────────────────────

addEventListener('keydown', event => {
	if (shell.anyDialogOpen() || editor.isOpen || photo.isOpen) return;
	if (event.target.closest?.('input, textarea')) return;
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	const key = event.key.toLowerCase();
	if (key === 'f') flip();
	else if (key === 'u') takeBack();
	else if (key === 'h') askHint();
	else if (key === 'v') changeSetting('view', settings.view === '2d' ? '3d' : '2d');
	else if (key === 'arrowleft') { handleAction('review-prev'); event.preventDefault(); }
	else if (key === 'arrowright') { handleAction('review-next'); event.preventDefault(); }
	else if (key === 'escape') { clearSelection(); refresh(); }
	else if (view === view3d && ['1', '2', '3'].includes(key)) view3d.moveTo({ 1: 'seat', 2: 'high', 3: 'over' }[key]);
});

// ── 摆棋与拍照 ────────────────────────────────────────────────────

const editor = createEditor({
	settings,
	onSetting: changeSetting,
	onPhoto: () => photo.open({ fromEditor: true }),
	onPlay: ({ fen, human }) => startGame({ human, fen }),
	toast: text => shell.toast(text)
});

const photo = createPhoto({
	recognizer: null,
	toast: text => shell.toast(text),
	// 识别结果交给摆棋编辑器核对。
	onResult: result => editor.open(null, result)
});

// ── 启动 ─────────────────────────────────────────────────────────

for (const key of ['board', 'pieces', 'coords']) body.dataset[key] = settings[key];
shell.paintSettings(settings);

const saved = loadGame();
if (saved) {
	playing = true;
	flipped = Boolean(saved.flipped);
	view.setFlipped(flipped);
	match.restore(saved);
	if (match.state.history.length) shell.toast('已恢复上一局', 1800);
} else {
	view.setPosition(match.state.pos);
	refresh();
	shell.open('dlg-new');
}
if (settings.view === '3d') setView('3d');

const boot = document.getElementById('boot');
requestAnimationFrame(() => {
	boot.classList.add('gone');
	setTimeout(() => boot.remove(), 400);
});
