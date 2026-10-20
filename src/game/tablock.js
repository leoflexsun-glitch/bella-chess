// 同一时刻只让一个标签页"在下"存档里的这盘棋——用户正看着（切到前台、点按、按键）的那一页。
// 其余标签页待命：不跑电脑思考、不计时、不写存档，几个页面就不会同时写同一个存档位、互相覆盖。
// 谁在下只记在存储里一处（KEY）。held 是缓存，给频繁调用的地方用；写存档、清档、接手等关键时刻用 check()
// 现读存储——标签页被冻结、从往返缓存恢复等情况下错过了通知，也能借此发现并转为待命。
// 别的页接手时本页通常能通过 storage 事件立刻得知（onLost），好停下思考、显示待命。
// 存储写不进去时只有本页能用存档，算本页在下；一旦收到别的页的 storage 事件（说明存储能用）就取消。

import { jsonStore } from '../core/store.js';

const KEY = 'frostfall.active';

export function createTabLock({ storage, events = globalThis, onLost } = {}) {
	const store = jsonStore(storage);
	const tabId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	let solo = false;
	let held = false;
	const owned = () => solo || store.get(KEY) === tabId;
	const lose = () => { held = false; onLost?.(); };

	events.addEventListener?.('storage', event => {
		solo = false;
		// key 为 null 表示存储被整个清空
		if (held && (event.key === null || event.key === KEY) && !owned()) lose();
	});

	return {
		get held() { return held; },
		check() {
			const now = owned();
			if (held && !now) lose();
			return now;
		},
		// 接手。返回接手前是否本来就是本页在下——不是的话，调用方要从存档重新读出最新局面。
		claim() {
			const had = owned();
			if (!had) solo = !store.set(KEY, tabId);
			held = true;
			return had;
		}
	};
}
