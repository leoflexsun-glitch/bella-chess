// 棋盘材质：在浏览器里用噪声程序生成极轻的木纹 / 石纹 / 纸纹，叠在校准过的格色上。
// 不下载任何图片；格色只在 board2d.css 定义一处，这里运行时读取，保证对比度校准不被改动。
// 生成结果以 CSS 变量 --board-img 挂到 <body>，未就绪时棋盘先显示纯色格。

function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6D2B79F5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// 值噪声 + 分形叠加：够细腻，又比 Perlin 便宜。
function makeNoise(seed) {
	const r = rng(seed), P = new Uint8Array(512), G = new Float32Array(256);
	for (let i = 0; i < 256; i++) { P[i] = i; G[i] = r(); }
	for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
	for (let i = 0; i < 256; i++) P[i + 256] = P[i];
	const fade = t => t * t * (3 - 2 * t);
	const n = (x, y) => {
		const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
		const a = G[P[(xi & 255) + P[yi & 255]]], b = G[P[((xi + 1) & 255) + P[yi & 255]]];
		const c = G[P[(xi & 255) + P[(yi + 1) & 255]]], d = G[P[((xi + 1) & 255) + P[(yi + 1) & 255]]];
		const top = a + (b - a) * u;
		return top + (c + (d - c) * u - top) * v;
	};
	return (x, y, octaves) => {
		let sum = 0, amp = 0.5, freq = 1, norm = 0;
		for (let i = 0; i < octaves; i++) { sum += amp * n(x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2.03; }
		return sum / norm - 0.5;
	};
}

// 每种材质只返回"相对格色的明暗偏移"（单位：0–255 色阶），幅度刻意压得很小。
const GRAIN = {
	// 枫木：沿横向的细木纹，每格错开，像一块块拼起来的木片。
	maple: fbm => (u, v, sq) => fbm(u * 1.2 + sq * 5.17, v * 16 + sq * 5.17, 3) * 9,
	// 雾灰蓝：石材般的大块云纹。
	mist: fbm => (u, v, sq) => fbm(u * 3 + sq, v * 3, 4) * 7,
	// 浅豆绿：纸张般的细腻颗粒。
	pale: fbm => (u, v) => fbm(u * 5, v * 5, 3) * 6
};

const hex = s => { const m = s.trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16)); };
const cache = new Map();

function colorsOf(theme) {
	const probe = document.createElement('i');
	probe.dataset.board = theme;
	probe.hidden = true;
	document.body.append(probe);
	const style = getComputedStyle(probe);
	const out = { light: hex(style.getPropertyValue('--sq-light')), dark: hex(style.getPropertyValue('--sq-dark')) };
	probe.remove();
	return out;
}

function render(theme, size) {
	const fbm = makeNoise(11);
	const grain = GRAIN[theme](fbm);
	const { light, dark } = colorsOf(theme);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d');
	const img = ctx.createImageData(size, size);
	const cell = size / 8;
	const seamWidth = Math.max(1, size / 640) / cell;   // 格与格之间一道极细的缝
	for (let y = 0; y < size; y++) {
		const v = y / cell, fy = Math.floor(v), dy = Math.min(v - fy, 1 - (v - fy));
		for (let x = 0; x < size; x++) {
			const u = x / cell, fx = Math.floor(u), dx = Math.min(u - fx, 1 - (u - fx));
			const isDark = (fx + fy) & 1;
			const base = isDark ? dark : light;
			const g = grain(u, v, fy * 8 + fx);
			const seam = Math.min(dx, dy) < seamWidth ? 0.95 : 1;
			const i = (y * size + x) * 4;
			img.data[i] = (base[0] + g) * seam;
			img.data[i + 1] = (base[1] + g) * seam;
			img.data[i + 2] = (base[2] + g * 0.85) * seam;
			img.data[i + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return new Promise(resolve => canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), 'image/jpeg', 0.92));
}

let pending = 0;

// 切换主题：先清掉旧材质（立即显示新主题的纯色格），空闲时再生成并挂上新材质。
export function applyBoardTexture(theme) {
	const ticket = ++pending;
	document.body.style.removeProperty('--board-img');
	if (!GRAIN[theme]) return;
	// 生成分辨率跟着屏幕走：棋盘物理像素以内，上限 1024。
	const px = Math.min(1024, Math.max(512, Math.round(Math.min(innerWidth, innerHeight) * (devicePixelRatio || 1) / 8) * 8));
	const key = `${theme}@${px}`;
	const run = async () => {
		if (!cache.has(key)) cache.set(key, render(theme, px));
		const url = await cache.get(key);
		if (url && ticket === pending) document.body.style.setProperty('--board-img', `url(${url})`);
	};
	(window.requestIdleCallback || (fn => setTimeout(fn, 60)))(() => { run(); }, { timeout: 400 });
}
