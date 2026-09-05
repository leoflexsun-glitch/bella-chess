import * as THREE from 'three';
import { createStage } from './scene/stage.js';
import { createLighting } from './scene/lighting.js';
import { createSky } from './world/sky.js';
import { createGround } from './world/ground.js';
import { createForest } from './world/forest.js';
import { createSnowfall } from './world/snowfall.js';
import { createProps } from './world/props.js';
import { createBoard, worldToSquare } from './game/board.js';
import { createTable } from './game/table.js';
import { createBursts } from './game/fx.js';
import { createMatch } from './game/match.js';
import { createHud } from './ui/hud.js';
import { createMenu, loadSettings } from './ui/menu.js';
import { createAudio } from './core/audio.js';
import { WHITE, BLACK, QUEEN, CAPTURE, colorOf } from './chess/engine.js';

const settings = loadSettings();
const audio = createAudio();
audio.enabled = settings.sound === 'on';

const boot = document.getElementById('boot');
const bootMsg = document.querySelector('[data-slot="boot"]');
const canvas = document.getElementById('stage');

const SIDE_TEXT = { [WHITE]: '象牙', [BLACK]: '黑曜' };
const LEVEL_TEXT = { novice: '新手', club: '棋社', expert: '专家', master: '大师' };
const QUALITY_TEXT = { ultra: '极致', high: '高', low: '低' };
const REASON_TEXT = {
	checkmate: '将杀',
	resignation: '认输',
	'flag fall': '超时判负',
	stalemate: '逼和',
	'fifty-move rule': '五十回合规则',
	'insufficient material': '子力不足',
	'threefold repetition': '三次重复局面'
};

const stage = createStage(canvas, settings.quality);
const { scene, camera, renderer } = stage;

bootMsg.textContent = '正在唤醒雪林…';

const lighting = createLighting(scene, stage.state.cfg);
const sky = createSky(scene, lighting.sunDir);
const ground = createGround(scene);
const forest = createForest(scene, stage.state.cfg);
const snowfall = createSnowfall(scene, stage.state.cfg);
const props = createProps(scene);
const bursts = createBursts(scene);

// 只从天空穹顶烘出来的一次性辐照环境贴图——便宜，而且正是它
// 让象牙和黑曜带上冷冽开阔的天光感。
{
	const envScene = new THREE.Scene();
	envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 24), sky.dome.material));
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(envScene, 0, 0.5, 60).texture;
	scene.environmentIntensity = 0.9;
	pmrem.dispose();
}

await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]);

const board = createBoard(scene);
const table = createTable(scene, bursts);

board.setHints(settings.hints === 'on');
// 手机/触屏：着色器提示在 mediump 精度下会丢，强制启用实体网格提示。
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) board.setOverlay(true);

table.setBadges(settings.badges === 'on');
snowfall.setDensity(settings.snow === 'heavy' ? 1 : settings.snow === 'light' ? 0.45 : 0);

// ── 状态 ────────────────────────────────────────────────────────

let selected = -1;
let legal = [];
let paused = false;
let playing = false;
let reviewing = false;
let checkSq = -1;

const hud = createHud({ onTool: tool => handleTool(tool) });

const match = createMatch({
	onReset: () => {
		table.sync(match.state.pos);
		selected = -1;
		legal = [];
		checkSq = -1;
		board.clearMarks();
		markLastMove();
		refresh();
	},
	onTurn: (color, check) => {
		hud.setTurn(color === WHITE ? 'w' : 'b', { thinking: match.state.thinking, check });
		board.clearMarks([2]);
		checkSq = check ? match.state.pos.kings[color >> 3] : -1;
		if (check) {
			board.setMark(match.state.pos.kings[color >> 3], 2, 1);
			audio.check();
		}
		refresh();
	},
	onMove: (move, { san, mover, captured }) => {
		table.playMove(move);
		if (captured) audio.capture(); else audio.place();
		selected = -1;
		legal = [];
		board.clearMarks([0, 1]);
		markLastMove(move);
		refresh();
		if (mover !== match.state.human) hud.toast(`${SIDE_TEXT[mover]}走出 ${san}`, 2000);
	},
	onThink: color => hud.setTurn(color === WHITE ? 'w' : 'b', { thinking: true }),
	onEnd: over => endGame(over),
	onError: message => hud.toast(message)
});

// 棋盘自己留着一个走子历史通道，让上一步一直亮着。
function markLastMove(move = match.state.lastMove) {
	board.clearMarks([3]);
	if (!move) return;
	board.setMark(move.from, 3, 0.7);
	board.setMark(move.to, 3, 1);
}

function refresh() {
	const tally = match.tally();
	hud.setMaterial(tally[WHITE], tally[BLACK]);
	hud.setEval(match.state.eval);
	hud.setLedger(match.state.history);
	hud.setClocks(match.state.clocks[WHITE], match.state.clocks[BLACK]);
}

// ── 选中 ────────────────────────────────────────────────────

function clearSelection() {
	selected = -1;
	legal = [];
	table.select(-1);
	board.clearMarks([0, 1]);
}

function selectSquare(sq) {
	const moves = match.movesFrom(sq);
	if (!moves.length) { audio.deny(); return false; }
	board.clearMarks([0, 1]);
	selected = sq;
	legal = moves;
	table.select(sq);
	board.setMark(sq, 0, 1);
	for (const move of moves) board.setMark(move.to, move.flags & CAPTURE ? 2 : 1, 1);
	audio.lift();
	return true;
}

function attempt(target) {
	const options = legal.filter(m => m.to === target);
	if (!options.length) return false;
	const from = selected;
	clearSelection();
	if (options.length > 1 && options[0].promotion) {
		hud.askPromotion(choice => { match.play(from, target, choice); });
		hud.toast('选择兵升变的棋子');
		return true;
	}
	match.play(from, target, QUEEN);
	return true;
}

// ── 指针 ──────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;

function pick(event) {
	pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
	raycaster.setFromCamera(pointer, camera);
	const onPiece = raycaster.intersectObjects(table.meshes, false)[0];
	if (onPiece) {
		const sq = table.squareOfMesh(onPiece.object);
		if (sq >= 0) return sq;
	}
	const onBoard = raycaster.intersectObject(board.field, false)[0];
	return onBoard ? worldToSquare(onBoard.point) : -1;
}

canvas.addEventListener('pointermove', event => {
	if (!playing || paused) { board.setHover(-1); return; }
	board.setHover(pick(event));
});

canvas.addEventListener('pointerdown', event => {
	downAt = { x: event.clientX, y: event.clientY };
});

function clickSquare(sq) {
	if (!playing || paused || hud.promoting) return;
	if (sq < 0) { clearSelection(); return; }

	if (selected >= 0 && attempt(sq)) return;

	const piece = match.state.pos.board[sq];
	if (piece && colorOf(piece) === match.state.human && !match.state.over) {
		if (sq === selected) clearSelection();
		else selectSquare(sq);
	} else {
		clearSelection();
	}
}

canvas.addEventListener('pointerup', event => {
	if (!playing || paused || !downAt) return;
	const dragged = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6;
	downAt = null;
	if (dragged) return;
	clickSquare(pick(event));
});

// ── 菜单 ─────────────────────────────────────────────────────────

const menu = createMenu({
	settings,
	audio,
	onSetting: applySetting,
	onAction: act => {
		if (act === 'play') startGame();
		else if (act === 'rematch') startGame();
		else if (act === 'controls') menu.show('controls', { push: true });
		else if (act === 'settings') menu.show('settings', { push: true });
		else if (act === 'resume') resume();
		else if (act === 'undo') { takeBack(); resume(); }
		else if (act === 'resign') { match.resign(); }
		else if (act === 'quit') toTitle();
		else if (act === 'review') review();
		else if (act === 'close') { if (playing) resume(); else menu.show('title'); }
	}
});

function setView(value) {
	const topdown = value === '2d';
	document.body.classList.toggle('mode2d', topdown);
	stage.setTopDown(topdown);
	table.setBadgeIcons(topdown);
	table.setBadges(topdown || settings.badges === 'on');
	hud.setTool('mode', topdown);
	hud.setTool('badges', topdown || settings.badges === 'on');
	if (playing) hud.setHint(topdown ? '俯瞰模式 · 点击棋子拿起，点击格子落子 · V 换回三维' : '拖拽旋转视角 · 点击棋子拿起');
}

function applySetting(key, value) {
	if (key === 'view') setView(value);
	else if (key === 'quality') stage.setQuality(value);
	else if (key === 'sound') audio.enabled = value === 'on';
	else if (key === 'hints') { board.setHints(value === 'on'); hud.setTool('hints', value === 'on'); }
	else if (key === 'badges') { table.setBadges(value === 'on' || settings.view === '2d'); hud.setTool('badges', value === 'on' || settings.view === '2d'); }
	else if (key === 'snow') snowfall.setDensity(value === 'heavy' ? 1 : value === 'light' ? 0.45 : 0);
}

stage.onQuality((next, automatic) => {
	lighting.setQuality(stage.state.cfg);
	snowfall.setQuality(stage.state.cfg);
	ground.setQuality(stage.state.cfg);
	bursts.setQuality(stage.state.cfg);
	menu.set('quality', next);
	if (automatic) hud.toast(`画质已自动降到${QUALITY_TEXT[next] || next}，以保持流畅帧率`, 4200);
});

// ── 流程 ─────────────────────────────────────────────────────────

function startGame() {
	const human = settings.side === 'b' ? BLACK : WHITE;
	stage.state.flipped = human === BLACK;
	playing = true;
	paused = false;
	reviewing = false;
	menu.hide();
	hud.show();
	hud.cancelPromotion();
	stage.setAttract(false);
	hud.setTool('hints', settings.hints === 'on');
	hud.setTool('badges', settings.badges === 'on');
	hud.setTool('sound', settings.sound === 'on');
	setView(settings.view);
	match.newGame({ human, level: settings.level });
}

function pause() {
	if (!playing || paused) return;
	paused = true;
	const move = Math.floor(match.state.history.length / 2) + 1;
	const side = SIDE_TEXT[match.state.pos.turn];
	menu.slot('pause-line', `第 ${move} 回合 · ${side}行棋`);
	menu.show('pause');
	stage.controls.enabled = settings.view !== '2d';
}

function resume() {
	if (!playing) return;
	paused = false;
	menu.hide();
}

function toTitle() {
	playing = false;
	paused = false;
	reviewing = false;
	clearSelection();
	hud.hide();
	stage.setAttract(true);
	menu.show('title');
}

function review() {
	reviewing = true;
	paused = false;
	menu.hide();
	hud.show();
	stage.setAttract(false);
	hud.toast('正在研究终局局面 · 按 Esc 离开');
}

function takeBack() {
	if (!playing || match.state.over) { audio.deny(); return; }
	clearSelection();
	if (match.undo()) hud.toast('已悔棋');
	else audio.deny();
}

function endGame(over) {
	const humanWon = over.winner === match.state.human;
	audio.end(humanWon);
	clearSelection();
	refresh();

	const title = over.reason === 'checkmate' ? '将杀'
		: over.reason === 'resignation' ? '认输'
		: over.reason === 'flag fall' ? '超时判负'
		: '和棋';
	menu.slot('result-title', title);
	menu.slot('result-over', over.winner
		? `${SIDE_TEXT[over.winner]}赢下这片空地`
		: `雪林守住了秘密 · ${REASON_TEXT[over.reason] || over.reason}`);

	const tally = match.tally();
	const stats = document.querySelector('[data-slot="result-stats"]');
	stats.innerHTML = [
		['回合', Math.ceil(match.state.history.length / 2)],
		['子力', tally[WHITE] > 0 ? `象牙 +${tally[WHITE]}` : tally[BLACK] > 0 ? `黑曜 +${tally[BLACK]}` : '持平'],
		['对手', LEVEL_TEXT[settings.level] || settings.level],
		['结局', REASON_TEXT[over.reason] || over.reason]
	].map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join('');

	setTimeout(() => menu.show('result'), 900);
}

// ── 按键与工具 ─────────────────────────────────────────────────

function handleTool(tool) {
	if (tool === 'hints') { settings.hints = settings.hints === 'on' ? 'off' : 'on'; menu.set('hints', settings.hints); applySetting('hints', settings.hints); }
	else if (tool === 'badges') { settings.badges = settings.badges === 'on' ? 'off' : 'on'; menu.set('badges', settings.badges); applySetting('badges', settings.badges); }
	else if (tool === 'sound') { settings.sound = settings.sound === 'on' ? 'off' : 'on'; menu.set('sound', settings.sound); applySetting('sound', settings.sound); hud.setTool('sound', settings.sound === 'on'); }
	else if (tool === 'mode') { settings.view = settings.view === '2d' ? '3d' : '2d'; menu.set('view', settings.view); applySetting('view', settings.view); }
	else if (tool === 'flip') { hud.toast(stage.flip() ? '棋盘已翻转 · 黑曜近手' : '棋盘已翻转 · 象牙近手'); }
	else if (tool === 'view') { hud.toast(`视角 · ${stage.cycleView()}`); }
	else if (tool === 'full') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
	else if (tool === 'pause') pause();
	else if (tool === 'undo') takeBack();
	else if (tool === 'copy') {
		navigator.clipboard?.writeText(match.pgn()).then(
			() => hud.toast('棋谱已复制'),
			() => hud.toast('剪贴板不可用')
		);
	}
}

addEventListener('keydown', event => {
	if (menu.current) return;
	const key = event.key.toLowerCase();
	if (key === 'escape') { if (reviewing) toTitle(); else pause(); }
	else if (key === '1') stage.moveTo('seat');
	else if (key === '2') stage.moveTo('high');
	else if (key === '3') stage.moveTo('over');
	else if (key === 'f') handleTool('flip');
	else if (key === 'u') handleTool('undo');
	else if (key === 'h') handleTool('hints');
	else if (key === 'm') handleTool('badges');
	else if (key === 'v') handleTool('mode');
});

// ── 循环 ─────────────────────────────────────────────────────────

let clockPaint = 0;

stage.onUpdate((dt, time) => {
	lighting.update(dt, time);
	sky.update(dt, time);
	ground.update(dt, time);
	forest.update(dt, time);
	snowfall.update(dt, time, camera);
	props.update(dt, time);
	board.update(dt, time);
	table.update(dt, time);
	bursts.update(dt, time);

	if (playing && !paused && !reviewing && !match.state.over) {
		match.tick(dt);
		clockPaint += dt;
		if (clockPaint > 0.2) {
			clockPaint = 0;
			hud.setClocks(match.state.clocks[WHITE], match.state.clocks[BLACK]);
		}
	}
});

// ── 启动 ─────────────────────────────────────────────────────────

table.sync(match.state.pos);
setView(settings.view);
menu.show('title');

// 标签页可见时等两帧，不可见时走定时器——无论哪条路，
// 幕布都会落下。
let curtain = false;
const raise = () => {
	if (curtain) return;
	curtain = true;
	boot.classList.add('gone');
	setTimeout(() => boot.remove(), 800);
};
requestAnimationFrame(() => requestAnimationFrame(raise));
setTimeout(raise, 1200);

