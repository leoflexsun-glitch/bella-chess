// 触感反馈：支持震动的手机上，落子、吃子、将军、终局各有一下轻震。
// 不支持的设备（如 iPhone 的 Safari）静默忽略。
// 桌面 Chrome 也有 navigator.vibrate，但没有马达：只在以触屏为主的设备上算"支持"。

export function createHaptics() {
	let on = true;
	const can = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
		&& typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	const buzz = pattern => {
		if (!on || !can) return;
		// 用户还没碰过页面（如恢复存档后电脑先走）：浏览器会拦下并报警告，干脆不震。
		if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
		try { navigator.vibrate(pattern); } catch { /* 部分浏览器在无用户手势时会拒绝，忽略 */ }
	};
	return {
		set enabled(v) { on = v; },
		get supported() { return can; },
		move() { buzz(8); },
		capture() { buzz(16); },
		check() { buzz([12, 60, 12]); },
		end(result) { buzz(result === 'win' ? [18, 70, 18, 70, 30] : [28]); }
	};
}
