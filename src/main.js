// 控制器：对局流程、选子与走子、设置、视图切换。
// 视图（2D 棋盘 / 3D 雪林）只负责显示与把指针动作翻译成意图，二者接口一致、可随时互换。

import { WHITE, BLACK, CAPTURE, KCASTLE, QCASTLE, fromFen, inCheck, colorOf, sanOf, other, START_FEN } from './chess/engine.js';
import { balance } from './chess/material.js';
import { createMatch } from './game/match.js';
import { createBoard2d } from './view2d/board.js';
import { applyBoardTexture } from './view2d/texture.js';
import { createView3d } from './view3d/view3d.js';
import { createShell } from './ui/shell.js';
import { loadSettings, saveSettings } from './ui/settings.js';
import { createSaveSlot } from './game/saveslot.js';
import { createAudio } from './core/audio.js';
import { createHaptics } from './core/haptics.js';
import { createClock } from './core/clock.js';
import { createEditor } from './editor/editor.js';
import { createPhoto } from './editor/photo.js';
import * as vision from './vision/index.js';

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
const haptics = createHaptics();
haptics.enabled = settings.haptics === 'on';
const body = document.body;

// ── 状态 ────────────────────────────────────────────────────────

let playing = false;      // 有一局正在进行（或刚结束、可悔棋）
let selected = -1;
let legal = [];
let pendingDeselect = false;
let promoting = null;      // 等待升变选择时：发起时的局面标记（见 promoKey），局面一变就作废
let reviewPly = null;      // 正在查看的历史半步；null = 当前局面
let flipped = false;
let resignArmed = 0;
let hintArrow = null;      // 电脑给出的提示着法 { from, to }，走子或悔棋后清除
// 本局用时：对局进行中且页面可见时计时（关页、切后台、终局后不计）。
// 中途打开摆棋、拍照、设置等窗口照常计时——和真实棋钟一样，离开棋盘不算暂停。
const clock = createClock();

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
	setPosition: (pos, opts) => board2d.setPosition(pos, opts),
	pulse: (sq, kind) => board2d.pulse(sq, kind),
	playMove: (move, after) => board2d.playMove(move, after),
	setMarks: marks => board2d.setMarks(marks),
	setFlipped: on => board2d.setFlipped(on),
	askPromotion: (to, color) => board2d.askPromotion(to, color)
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
	onReset: reason => {
		clearSelection();
		hintArrow = null;
		reviewPly = null;
		// 悔棋时棋子平滑滑回原位；新开局、恢复存档直接摆好。
		view.setPosition(match.state.pos, { animate: reason === 'undo' });
		syncClock();               // 终局后悔棋接着下，接着计时
		if (reason !== 'restore') persist({ claim: true });   // 恢复存档不是新操作，不抢存档位
		refresh();
	},
	onMove: (move, { mover, captured }) => {
		const s = match.state;
		const live = reviewPly === null;
		hintArrow = null;
		if (live) view.playMove(move, s.pos);
		if (move.flags & (KCASTLE | QCASTLE)) audio.castle();
		else if (move.promotion) audio.promote();
		else if (captured) audio.capture();
		else audio.place();
		// 将军提示只在真走出将军时给（悔棋、恢复存档不重复提醒）；将杀由终局接手。
		const check = !s.over && inCheck(s.pos);
		if (check) {
			audio.check();
			if (live) view.pulse?.(kingSq(s.pos, s.pos.turn), 'check');
		}
		// 每步只震一种：新的震动会打断还没震完的上一个。终局由 onEnd 震。
		if (!s.over) {
			if (check) haptics.check();
			else if (captured) haptics.capture();
			else haptics.move();
		}
		if (mover !== match.state.human) clearSelection();
		// 电脑应着不是人的操作，不抢存档位；终局的存档由 onEnd 处理。
		if (!s.over) persist({ claim: mover === match.state.human });
		refresh();
	},
	onThink: () => refresh(),
	onEnd: over => {
		clearSelection();
		syncClock();
		persist();
		const result = outcome(over);
		audio.end(result);
		haptics.end(result);
		// 胜方王格金光呼吸（在棋子下面，不挡棋子）。
		if (over.winner && reviewPly === null) view.pulse?.(kingSq(match.state.pos, over.winner), 'win');
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
	if (promoting && promoting !== promoKey()) dropPromotion();
	const s = match.state;
	const pos = currentPos();

	// 棋盘标记
	const lastMove = reviewPly === null ? s.lastMove : (reviewPly >= 0 ? s.history[reviewPly].move : null);
	const checked = inCheck(pos) ? kingSq(pos, pos.turn) : -1;
	view.setMarks({
		lastMove,
		selected,
		targets: settings.hints === 'on' ? legal.map(m => ({ sq: m.to, capture: Boolean(m.flags & CAPTURE) })) : [],
		check: checked,
		arrow: reviewPly === null ? hintArrow : null,
		result: reviewPly === null && s.over ? resultMarks(s) : null
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
	const result = playing && s.over ? resultText(s.over) : null;
	if (!playing) shell.setStatus('选择对局方式开始');
	else if (reviewPly !== null) shell.setStatus('正在复盘');
	else if (result) shell.setStatus(result.title);   // 小屏手机上结算卡可能在屏幕外，胜负要在这里看得到
	else if (s.thinking) shell.setStatus('电脑思考中…');
	else if (s.pos.turn === s.human) shell.setStatus(checked >= 0 ? '将军！轮到你走' : '轮到你走', { check: checked >= 0 });
	else shell.setStatus(`轮到${SIDE[s.pos.turn]}`);

	shell.setEval(s.eval, match.result());
	shell.setReview(reviewPly === null ? null
		: reviewPly < 0 ? `起始局面 · 共 ${s.history.length} 步` : `第 ${reviewPly + 1} / ${s.history.length} 步`);
	shell.setResult(result);
	// 棋谱放在最后：复盘条、结算卡出现会挤小棋谱区，滚动要按最终布局算。
	shell.setMoves(s.history, reviewPly === null ? s.history.length - 1 : reviewPly);

	shell.setControl('undo', { disabled: !playing || !s.history.some(h => h.mover === s.human) });
	shell.setControl('resign', { disabled: !playing || Boolean(s.over) });
	shell.setControl('copy', { disabled: !s.history.length && s.startFen === START_FEN });
	shell.setControl('hint', { disabled: !canMove() });
}

// 终局时王格底光：胜方金色、负方灰暗、和棋两王淡光。
function resultMarks(s) {
	const king = color => kingSq(s.pos, color);
	if (!s.over.winner) return { draw: [king(WHITE), king(BLACK)] };
	return { win: king(s.over.winner), lose: king(other(s.over.winner)) };
}

function resultText(over) {
	const s = match.state;
	const reason = REASON_TEXT[over.reason] || over.reason;
	const secs = Math.round(clock.read() / 1000);
	const captures = s.history.filter(h => h.captured).length;
	// 回合按棋谱编号算：从黑方先走的局面开局时，半步数除以 2 会少算一回合。
	const rounds = s.history.length ? s.history.at(-1).no - s.history[0].no + 1 : 0;
	const stats = `共 ${rounds} 回合 · 用时 ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · 吃子 ${captures} 次`;
	const result = outcome(over);
	if (result === 'draw') return { title: '和棋', sub: reason, stats };
	return { title: result === 'win' ? '你赢了！' : '你输了', sub: `${SIDE[over.winner]}胜 · ${reason}`, stats };
}

// 本局对人而言的结局：'win' / 'lose' / 'draw'（音效、震动、结算文案共用）。
function outcome(over) {
	if (!over.winner) return 'draw';
	return over.winner === match.state.human ? 'win' : 'lose';
}

// 存档（多标签页规则见 game/saveslot.js）。claim：人的真实操作；终局时只清掉存着本局的存档位。
const saveSlot = createSaveSlot();
let gameId = '';
const newGameId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function persist({ claim = false } = {}) {
	if (!playing) return;
	const s = match.state;
	if (s.over) { saveSlot.end(gameId); return; }
	saveSlot.save({ id: gameId, fen: s.startFen, moves: match.moves(), human: s.human, level: s.level, flipped, elapsed: clock.read() }, { claim });
}

const kingSq = (pos, color) => pos.kings[color >> 3];

const inProgress = () => playing && !match.state.over;

// 计时与否只由一个条件决定：对局进行中且页面可见。
function syncClock() {
	if (inProgress() && !document.hidden) clock.resume();
	else clock.stop();
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
		const key = promoting = promoKey();
		refresh();
		view.askPromotion(to, color).then(type => {
			if (promoting !== key) return;   // 已作废：局面变了，棋盘已由别处同步
			promoting = null;
			if (type) match.play(from, to, type);
			else { view.setPosition(currentPos()); refresh(); }
		});
		return true;
	}
	match.play(from, to);
	return true;
}

// ── 流程 ─────────────────────────────────────────────────────────

// 任何入口（新对局、再来一局、摆棋、拍照复刻）都是一盘全新的对局：
// 先收掉上一局遗留的升变选择、复盘位置，再交给 match 清空棋谱。
function startGame({ human, level = settings.level, fen = START_FEN }) {
	reviewPly = null;
	gameId = newGameId();
	playing = true;
	flipped = human === BLACK;
	view.setFlipped(flipped);
	shell.close('dlg-new');
	clock.start();
	match.newGame({ human, level, fen });
	audio.start();
}

function resolveSide(side) {
	if (side === 'random') return Math.random() < 0.5 ? WHITE : BLACK;
	return side === 'b' ? BLACK : WHITE;
}

// 升变选择只对发起时的局面有效：重开、悔棋、终局（含认输）、复盘、翻转都会让它作废（refresh 里检查）。
const promoKey = () => `${gameId}|${match.state.history.length}|${reviewPly}|${flipped}|${Boolean(match.state.over)}`;

// 收掉等待中的升变选择（棋盘会把拖到底线的兵放回原格）。
function dropPromotion() {
	if (!promoting) return;
	promoting = null;
	board2d.cancelPromotion();
	shell.close('dlg-promo');
}

function takeBack() {
	if (!playing) return;
	dropPromotion();
	reviewPly = null;
	if (match.undo(1)) { shell.toast('已悔棋', 1200); return; }
	// 没有可悔的棋：仍把棋盘拉回当前局面（可能停在复盘位置，或升变待选时兵已画在底线）。
	view.setPosition(match.state.pos, { animate: true });
	refresh();
	audio.deny();
	shell.toast('没有可以悔的棋');
}

function reviewTo(ply) {
	const s = match.state;
	if (!s.history.length) return;
	const next = Math.max(-1, Math.min(s.history.length - 1, ply));
	const target = next === s.history.length - 1 ? null : next;
	if (target === reviewPly) return;   // 没变（如已在最新一步再按"下一步"）：什么都不做，也不打断升变选择
	clearSelection();
	reviewPly = target;
	view.setPosition(currentPos(), { animate: true });
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
	if (key === 'board') applyBoardTexture(v);
	else if (key === 'sound') audio.enabled = v === 'on';
	else if (key === 'haptics') { haptics.enabled = v === 'on'; if (v === 'on') haptics.move(); }
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
	recognizer: vision,
	toast: text => shell.toast(text),
	// 识别结果交给摆棋编辑器核对。
	onResult: result => editor.open(null, result)
});

// ── 启动 ─────────────────────────────────────────────────────────

for (const key of ['board', 'pieces', 'coords']) body.dataset[key] = settings[key];
// 不支持震动的设备（iPhone 的 Safari、桌面电脑）不显示震动开关，免得开了没反应。
if (!haptics.supported) shell.hideSetting('haptics');

// 切到后台或关页：对局进行中就存一次档（含已用时长），再按可见性停表/续表。
// 关页时 pagehide 与 visibilitychange 都会触发，只存一次。
let leftSaved = false;
const saveOnLeave = () => {
	if (leftSaved) return;
	leftSaved = true;
	if (inProgress()) persist();
};
document.addEventListener('visibilitychange', () => {
	if (document.hidden) saveOnLeave();
	else leftSaved = false;
	syncClock();
});
window.addEventListener('pagehide', saveOnLeave);
applyBoardTexture(settings.board);
shell.paintSettings(settings);

const saved = saveSlot.load();
if (saved) {
	playing = true;
	gameId = saved.id || newGameId();
	flipped = Boolean(saved.flipped);
	clock.start(saved.elapsed);             // restore 之后的 onReset 会按可见性决定是否计时
	view.setFlipped(flipped);
	match.restore(saved);
	if (!saved.id) persist({ claim: true }); // 旧版存档：补上对局 id，终局时才认得出、清得掉
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
