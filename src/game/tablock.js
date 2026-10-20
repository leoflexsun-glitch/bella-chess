// 同一时刻只让一个标签页"在下"存档里的这盘棋——用户正看着（切到前台、点按）的那一页。
// 其余标签页待命：不跑电脑思考、不计时、不写存档，几个页面就不会同时写同一个存档位、互相覆盖。
// 别的页接手时，本页通过 storage 事件得知（onLost）；用户回到本页时由调用方 claim 接回，并重新读出存档。
// 存储不可用（沙箱等）时只有本页能用存档，claim 照样成功。

import { jsonStore } from '../core/store.js';
import { randomId } from '../core/id.js';

const KEY = 'frostfall.active';

export function createTabLock({ storage, events = globalThis, onLost } = {}) {
	const store = jsonStore(storage);
	const tabId = randomId();
	let held = false;

	events.addEventListener?.('storage', event => {
		// key 为 null 表示存储被整个清空
		if (!held || (event.key !== null && event.key !== KEY)) return;
		if (store.get(KEY) === tabId) return;
		held = false;
		onLost?.();
	});

	return {
		get held() { return held; },
		claim() {
			store.set(KEY, tabId);
			held = true;
		}
	};
}
