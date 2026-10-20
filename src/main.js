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
import { createTabLock } from './game/tablock.js';
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
	hide() { board2d.cancelPromotion(); },   // 无待选升变时是空操作
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
		resignArmed = 0;           // "再按一次认输"只对当前这局有效
		clearSelection();
		hintArrow = null;
		reviewPly = null;
		// 悔棋时棋子平滑滑回原位；新开局、恢复存档直接摆好。
		view.setPosition(match.state.pos, { animate: reason === 'undo' });
		syncClock();               // 终局后悔棋接着下，接着计时
		if (reason !== 'restore') saveGame();   // 恢复存档不必写回
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
		saveGame();
		refresh();
	},
	onThink: () => refresh(),
	onEnd: over => {
		clearSelection();
		syncClock();
		if (playing && lock.check()) saveSlot.finish();
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
	return playing && !s.over && !s.thinking && s.pos.turn === s.human && reviewPly === null && !promoting && lock.held;
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

// 存档：同一时刻只有一个标签页在下这盘棋（tablock.js），只有它写。别的页接手时本页待命（standBy），
// 用户回到本页时接回，并在需要时重新读出存档（resume）。
const saveSlot = createSaveSlot();
const lock = createTabLock({ onLost: standBy });
let gameNo = 0;            // 每开一局、每恢复一次存档加一（升变选择据此作废）

// 写存档：只写本页在下、仍在进行的对局。已结束的局由 onEnd 写入终局标记，不能再写回（否则会被当成进行中恢复）。
function currentSnapshot() {
	const s = match.state;
	return { fen: s.startFen, moves: match.moves(), human: s.human, level: s.level, flipped, elapsed: clock.read() };
}

function saveGame() {
	if (inProgress() && lock.check()) saveSlot.save(currentSnapshot());
}

// 别的标签页接手了这盘棋：本页停下电脑思考与计时，不再写存档。
// 确实有一盘正在别处下时，显示待命提示（两个窗口并排时看得到；它是模态对话框，叠在其他对话框之上）。
function standBy() {
	match.pause();
	clearSelection();
	syncClock();
	if (saveSlot.load()) shell.setStandby(true);
	refresh();
}

// 用户回到本页（切到前台、点按、按键）：接手这盘棋。之前若是别的页在下，就从存档读出最新局面——
// 别的页可能已经接着下了。存档标着"已下完"：本页这局还在进行就说明它已在别处结束，作废并回到新对局
// （本页这局本来就结束了则留着结算）。存档为空（比如存储被清空）：以本页为准接着存。
function resume() {
	if (lock.claim()) return;
	shell.setStandby(false);
	const saved = saveSlot.load();
	if (saved) {
		shell.close('dlg-new');            // 别在对话框后面悄悄换了局面：让用户看到接回的这盘
		restoreGame(saved);
	} else if (saveSlot.finished && inProgress()) {
		playing = false;
		match.newGame();
		if (!editor.isOpen && !photo.isOpen) shell.open('dlg-new');   // 正在摆棋、拍照时不打扰
	} else if (inProgress()) {
		// 存档为空（比如存储被清空）：以本页为准。重新"恢复"一遍本页的局面——
		// 待命时停下的电脑思考与计时随之恢复——再存上。
		restoreGame(currentSnapshot());
		saveGame();
	} else refresh();
}

function restoreGame(saved) {
	playing = true;
	gameNo++;
	flipped = Boolean(saved.flipped);
	clock.start(saved.elapsed);             // restore 之后的 onReset 会按可见性决定是否计时
	view.setFlipped(flipped);
	match.restore(saved);
}

const kingSq = (pos, color) => pos.kings[color >> 3];

const inProgress = () => playing && !match.state.over;

// 计时与否只由一个条件决定：本页在下、对局进行中且页面可见。
function syncClock() {
	if (inProgress() && !document.hidden && lock.held) clock.resume();
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
	lock.claim();              // 开新局是明确的操作：本页接手（别的页转为待命）
	shell.setStandby(false);
	reviewPly = null;
	gameNo++;
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
const promoKey = () => `${gameNo}|${match.state.history.length}|${reviewPly}|${flipped}|${Boolean(match.state.over)}|${lock.held}`;

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
	saveGame();                // 翻转随存档走，立刻存
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
		dropPromotion();
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
		case 'resume': resume(); break;
		case 'resign':
			if (!inProgress()) break;
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

// 切到后台或关页：存下已用时长，再按可见性停表/续表；切回来时接回这盘棋。
// 关页时两个事件都会触发，重复存一次无妨。
document.addEventListener('visibilitychange', () => {
	if (document.hidden) saveGame();
	else resume();
	syncClock();
});
window.addEventListener('pagehide', saveGame);
// 两个窗口并排时，切到另一个窗口不会触发 visibilitychange：失焦时也存一次用时，免得被接手时丢掉。
window.addEventListener('blur', saveGame);
// 对局进行中、页面可见时每 15 秒存一次用时：别的窗口抢先接手时（失焦存档与对方接手跨进程、先后不定）最多丢 15 秒。
setInterval(() => { if (!document.hidden) saveGame(); }, 15000);

// 在待命的窗口里点按或按本应用的快捷键，就接回这盘棋。这一下只用来接回，不作用到刚读出的局面上：
// 按下被拦住，同一次的抬起与随后的 click 也吞掉。组合键、功能键（切窗口、刷新、查找等）不拦。
let swallowPointer = null, swallowClick = false;
const appKey = event => !event.ctrlKey && !event.metaKey && !event.altKey
	&& (event.key.length === 1 || ['Enter', 'Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key));
const takeOver = event => {
	resume();
	event.preventDefault();
	event.stopPropagation();
};
addEventListener('pointerdown', event => {
	swallowClick = false;
	swallowPointer = null;
	if (lock.check()) return;
	swallowPointer = event.pointerId;
	takeOver(event);
}, { capture: true });
addEventListener('pointerup', event => {
	if (event.pointerId !== swallowPointer) return;
	swallowPointer = null;
	swallowClick = true;                 // click 紧随抬起；若没有 click（比如拖走了），过一会儿自动失效
	setTimeout(() => { swallowClick = false; }, 400);
	event.stopPropagation();
}, { capture: true });
addEventListener('pointercancel', event => { if (event.pointerId === swallowPointer) swallowPointer = null; }, { capture: true });
addEventListener('click', event => {
	if (!swallowClick) return;
	swallowClick = false;
	event.preventDefault();
	event.stopPropagation();
}, { capture: true });
addEventListener('keydown', event => { if (appKey(event) && !lock.check()) takeOver(event); }, { capture: true });
applyBoardTexture(settings.board);
shell.paintSettings(settings);

// 在后台打开的标签页（按住 Ctrl 点开、浏览器恢复会话）先不接手，用户切过来时再接（见 resume），免得打断正在下的那页。
const background = document.hidden;
if (!background) lock.claim();
const saved = background ? null : saveSlot.load();
if (saved) {
	restoreGame(saved);
	if (match.state.history.length) shell.toast('已恢复上一局', 1800);
} else {
	view.setPosition(match.state.pos);
	refresh();
	// 后台打开的页也先打开新对局对话框：用户切过来时，若接回了一盘对局，resume 会关掉它
	shell.open('dlg-new');
}
if (settings.view === '3d') setView('3d');

const boot = document.getElementById('boot');
requestAnimationFrame(() => {
	boot.classList.add('gone');
	setTimeout(() => boot.remove(), 400);
});
