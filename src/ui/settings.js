// 设置：读写本机存储。隐私模式等环境下存储可能抛错，一律降级为只在内存里生效。

const STORE = 'frostfall.v2';
const LEGACY = 'frostfall.settings';

export const DEFAULTS = {
	view: '2d',
	board: 'green',
	pieces: 'celtic',
	coords: 'on',
	hints: 'on',
	sound: 'on',
	side: 'w',
	level: 'club',
	quality: 'high',
	snow: 'heavy',
	badges: 'off'
};

// 每项的合法取值；存储里读到别的值（旧版本、手改）就回落默认。
const ALLOWED = {
	view: ['2d', '3d'],
	board: ['green', 'brown', 'blue'],
	pieces: ['celtic', 'chessnut', 'fantasy'],
	coords: ['on', 'off'],
	hints: ['on', 'off'],
	sound: ['on', 'off'],
	side: ['w', 'b', 'random'],
	level: ['novice', 'club', 'expert', 'master'],
	quality: ['ultra', 'high', 'low'],
	snow: ['heavy', 'light', 'off'],
	badges: ['on', 'off']
};

function read(key) {
	try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

export function loadSettings() {
	const saved = read(STORE);
	// 旧版设置只继承与新界面无冲突的几项（视图默认改为 2D，不继承）。
	const legacy = saved ? null : read(LEGACY);
	const source = saved || (legacy && { sound: legacy.sound, hints: legacy.hints, side: legacy.side, level: legacy.level, quality: legacy.quality, snow: legacy.snow, badges: legacy.badges }) || {};
	const out = { ...DEFAULTS };
	for (const key of Object.keys(DEFAULTS)) {
		if (ALLOWED[key].includes(source[key])) out[key] = source[key];
	}
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
