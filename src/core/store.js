// 本机存储（JSON）：读写失败一律静默降级。
// 隐私模式、禁用站点数据、沙箱 iframe 等环境里，连访问 localStorage 这个属性都会抛错，所以惰性取、只在 try 里碰。

export function jsonStore(storage, area = 'localStorage') {
	const target = () => storage ?? globalThis[area];
	return {
		get(key) {
			try { return JSON.parse(target().getItem(key) || 'null'); } catch { return null; }
		},
		// value 为 null 表示删除；返回是否成功（存满、被禁用时为 false）
		set(key, value) {
			try {
				if (value === null) target().removeItem(key);
				else target().setItem(key, JSON.stringify(value));
				return true;
			} catch {
				return false;   // 存不了就只在本次会话生效
			}
		}
	};
}
