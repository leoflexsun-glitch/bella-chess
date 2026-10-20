// 同一时刻只让一个标签页"在下"存档里的这盘棋——用户正看着（切到前台、点按、按键）的那一页。
// 其余标签页待命：不跑电脑思考、不计时、不写存档，几个页面就不会同时写同一个存档位、互相覆盖。
// 谁在下只记在存储里一处（KEY），held 每次现读：标签页被冻结、从往返缓存恢复等情况下错过了通知，
// 也不会误以为自己还在下。别的页接手时本页通常能通过 storage 事件立刻得知（onLost），好停下思考、显示待命。
// 存储不可用（沙箱等）时只有本页，始终算在下。

import { jsonStore } from '../core/store.js';

const KEY = 'frostfall.active';

export function createTabLock({ storage, events = globalThis, onLost } = {}) {
	const store = jsonStore(storage);
	const tabId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	let solo = false;
	const held = () => solo || store.get(KEY) === tabId;
	let active = false;        // 上次得知时本页是否在下（只用来判断是否需要通知 onLost）

	events.addEventListener?.('storage', event => {
		// key 为 null 表示存储被整个清空
		if (!active || (event.key !== null && event.key !== KEY) || held()) return;
		active = false;
		onLost?.();
	});

	return {
		get held() { return held(); },
		// 接手。返回接手前是否本来就是本页在下——不是的话，调用方要从存档重新读出最新局面。
		claim() {
			const had = held();
			if (!had) solo = !store.set(KEY, tabId);
			active = true;
			return had;
		}
	};
}
