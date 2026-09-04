const STORE = 'frostfall.settings';

export const OPTIONS = {
	side: [{ id: 'w', label: '象牙' }, { id: 'b', label: '黑曜' }],
	level: [
		{ id: 'novice', label: '新手' },
		{ id: 'club', label: '棋社' },
		{ id: 'expert', label: '专家' },
		{ id: 'master', label: '大师' }
	],
	quality: [{ id: 'ultra', label: '极致' }, { id: 'high', label: '高' }, { id: 'low', label: '低' }],
	snow: [{ id: 'heavy', label: '大雪' }, { id: 'light', label: '小雪' }, { id: 'off', label: '关闭' }],
	sound: [{ id: 'on', label: '开' }, { id: 'off', label: '关' }],
	hints: [{ id: 'on', label: '开' }, { id: 'off', label: '关' }],
	badges: [{ id: 'off', label: '关' }, { id: 'on', label: '开' }]
};

const DEFAULTS = { side: 'w', level: 'club', quality: 'high', snow: 'heavy', sound: 'on', hints: 'on', badges: 'off' };

export function loadSettings() {
	try {
		return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
	} catch {
		return { ...DEFAULTS };
	}
}

export function createMenu({ settings, onAction, onSetting, audio }) {
	const screens = new Map();
	document.querySelectorAll('[data-screen]').forEach(el => screens.set(el.dataset.screen, el));
	const body = document.body;

	let current = null;
	let index = 0;
	let stack = [];

	const items = () => current ? [...screens.get(current).querySelectorAll('.mi')] : [];

	function paint() {
		items().forEach((el, i) => {
			el.classList.toggle('sel', i === index);
			const key = el.dataset.act;
			if (OPTIONS[key]) {
				const chosen = OPTIONS[key].find(o => o.id === settings[key]) || OPTIONS[key][0];
				el.querySelector('.v').textContent = chosen.label;
			}
		});
	}

	function show(name, { push = false } = {}) {
		if (current === name) return;
		if (push && current) stack.push(current);
		if (current) screens.get(current).classList.remove('on');
		current = name;
		index = 0;
		if (!name) { body.classList.add('playing'); return; }
		body.classList.remove('playing');
		const el = screens.get(name);
		// 重新播放交错入场动画。
		el.classList.remove('on');
		void el.offsetWidth;
		el.classList.add('on');
		paint();
	}

	function hide() {
		if (current) screens.get(current).classList.remove('on');
		current = null;
		stack = [];
		body.classList.add('playing');
	}

	function back() {
		const previous = stack.pop();
		if (previous) show(previous);
		else onAction('close');
	}

	function cycle(step) {
		const el = items()[index];
		const key = el?.dataset.act;
		if (!OPTIONS[key]) return false;
		const list = OPTIONS[key];
		const at = Math.max(0, list.findIndex(o => o.id === settings[key]));
		settings[key] = list[(at + step + list.length) % list.length].id;
		localStorage.setItem(STORE, JSON.stringify(settings));
		paint();
		audio.tick();
		onSetting(key, settings[key]);
		return true;
	}

	function activate() {
		const el = items()[index];
		if (!el) return;
		if (cycle(1)) return;
		audio.confirm();
		const act = el.dataset.act;
		if (act === 'back') back();
		else onAction(act);
	}

	function move(step) {
		const list = items();
		if (!list.length) return;
		index = (index + step + list.length) % list.length;
		audio.tick();
		paint();
	}

	document.addEventListener('keydown', event => {
		if (!current) return;
		const key = event.key;
		if (key === 'ArrowDown' || key === 's' || key === 'S') { move(1); event.preventDefault(); }
		else if (key === 'ArrowUp' || key === 'w' || key === 'W') { move(-1); event.preventDefault(); }
		else if (key === 'ArrowRight' || key === 'd' || key === 'D') { cycle(1); event.preventDefault(); }
		else if (key === 'ArrowLeft' || key === 'a' || key === 'A') { cycle(-1); event.preventDefault(); }
		else if (key === 'Enter' || key === ' ') { activate(); event.preventDefault(); }
		else if (key === 'Escape') { audio.back(); back(); event.preventDefault(); }
	});

	document.addEventListener('pointermove', event => {
		if (!current) return;
		const el = event.target.closest?.('.mi');
		if (!el) return;
		const at = items().indexOf(el);
		if (at >= 0 && at !== index) { index = at; audio.tick(); paint(); }
	});

	document.addEventListener('click', event => {
		if (!current) return;
		const el = event.target.closest?.('.mi');
		if (!el) return;
		index = Math.max(0, items().indexOf(el));
		activate();
		el.blur();
	});

	return {
		show, hide, back, paint,
		get current() { return current; },
		set(name, value) { settings[name] = value; localStorage.setItem(STORE, JSON.stringify(settings)); paint(); },
		slot(name, text) {
			const el = document.querySelector(`[data-slot="${name}"]`);
			if (el) el.textContent = text;
		}
	};
}
