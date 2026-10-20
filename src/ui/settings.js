// 设置：读写本机存储。隐私模式等环境下存储可能抛错，一律降级为只在内存里生效。

const STORE = 'frostfall.v2';
const LEGACY = 'frostfall.settings';

export const DEFAULTS = {
	view: '2d',
	board: 'maple',
	pieces: 'chessnut',
	coords: 'on',
	hints: 'on',
	sound: 'on',
	haptics: 'on',
	side: 'w',
	level: 'club',
	quality: 'high',
	snow: 'heavy',
	badges: 'off'
};

// 每项的合法取值；存储里读到别的值（旧版本、手改）就回落默认。
const ALLOWED = {
	view: ['2d', '3d'],
	board: ['maple', 'mist', 'pale'],
	pieces: ['celtic', 'chessnut', 'fantasy'],
	coords: ['on', 'off'],
	hints: ['on', 'off'],
	sound: ['on', 'off'],
	haptics: ['on', 'off'],
	side: ['w', 'b', 'random'],
	level: ['novice', 'club', 'expert', 'master'],
	quality: ['ultra', 'high', 'low'],
	snow: ['heavy', 'light', 'off'],
	badges: ['on', 'off']
};

function read(key) {
	try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

// 第 3 版换了棋盘配色（按对比度重新校准）并把默认棋子改为纯白纯黑的"经典"：
// 旧主题一一对应迁移，旧默认棋子（立体）改为经典；用户刻意选过的其他棋子保留。
const SCHEMA = 3;
const BOARD_V2 = { brown: 'maple', blue: 'mist', green: 'pale' };

export function loadSettings() {
	const saved = read(STORE);
	if (saved && saved.schema !== SCHEMA) {
		saved.board = BOARD_V2[saved.board] || saved.board;
		if (saved.pieces === 'celtic') saved.pieces = 'chessnut';
	}
	// 旧版设置只继承与新界面无冲突的几项（视图默认改为 2D，不继承）。
	const legacy = saved ? null : read(LEGACY);
	const source = saved || (legacy && { sound: legacy.sound, hints: legacy.hints, side: legacy.side, level: legacy.level, quality: legacy.quality, snow: legacy.snow, badges: legacy.badges }) || {};
	const out = { ...DEFAULTS };
	for (const key of Object.keys(DEFAULTS)) {
		if (ALLOWED[key].includes(source[key])) out[key] = source[key];
	}
	out.schema = SCHEMA;
	return out;
}

export function saveSettings(settings) {
	try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* 存不了就只在本次会话生效 */ }
}

// 进行中的对局：刷新或关掉标签页后能接着下。
const GAME = 'frostfall.game';

export function saveGame(snapshot) {
	try {
		if (snapshot) localStorage.setItem(GAME, JSON.stringify(snapshot));
		else localStorage.removeItem(GAME);
	} catch { /* 同上 */ }
}

export function loadGame() {
	const g = read(GAME);
	if (!g || typeof g.fen !== 'string' || !Array.isArray(g.moves)) return null;
	return g;
}
