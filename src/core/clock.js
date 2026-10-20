// 对局用时：只计开着页面下棋的时间。
// 用单调时钟（系统改时间、校时都不影响，也不会出现负数）；页面隐藏、关页、终局时由调用方停表，
// 存档里只保存累计时长，恢复时接着累加。

export function createClock(now = () => performance.now()) {
	let spent = 0;
	let since = null;            // 本段开始计时的时刻；null = 停表
	const read = () => spent + (since === null ? 0 : Math.max(0, now() - since));
	return {
		start(already = 0) { spent = Math.max(0, Number(already) || 0); since = now(); },
		resume() { since ??= now(); },
		stop() { spent = read(); since = null; },
		read,
		get running() { return since !== null; }
	};
}
