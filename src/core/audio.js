// 音效：全部现场合成，没有资源文件。
// 落子声用"模态合成"模拟木块敲击：一段几毫秒的噪声激励 + 几个按指数衰减的共振分音（棋子本身），
// 再叠一记低频"咚"（棋盘的共鸣）。每次敲击音高和衰减都带一点随机，听起来不机械。
// 提示性的声音（将军、升变、终局）用钟声分音，音量压低，只做点缀。

// 软削波曲线覆盖输入 ±CLIP_RANGE（进入前先按此缩小）：|x| ≤ 0.6 原样输出，之上用 tanh 平滑逼近 1。
const CLIP_RANGE = 2;
function softClipCurve(n = 2048) {
	const knee = 0.6;
	const curve = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const x = (i / (n - 1) * 2 - 1) * CLIP_RANGE;
		const a = Math.abs(x);
		curve[i] = Math.sign(x) * (a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
	}
	return curve;
}

export function createAudio() {
	let ctx = null;
	let out = null;
	let on = true;

	// 总线末端是无状态的软削波：单个声音（峰值约 -7 dBFS）完全线性通过，
	// 几个声音叠在一起时才把尖峰圆滑地压在 0 dB 以内。
	// 不用 DynamicsCompressor：Chromium 里它刚创建时处在最大压缩状态，开局第一声会小约 10 dB。
	function build() {
		const ac = new (window.AudioContext || window.webkitAudioContext)();
		try {
			const clip = ac.createWaveShaper();
			clip.curve = softClipCurve();
			clip.oversample = '2x';
			out = ac.createGain();
			out.gain.value = 0.7 / CLIP_RANGE;
			out.connect(clip).connect(ac.destination);
			return ac;
		} catch (error) {
			ac.close?.()?.catch?.(() => {});   // 建到一半失败：关掉已建的上下文，别泄漏（浏览器对个数有上限）
			throw error;
		}
	}

	const ready = () => {
		if (!on) return null;
		if (!ctx) {
			try { ctx = build(); } catch {
				// 浏览器禁用了 Web Audio 等：静音继续下棋，别让音效的异常打断走子流程。
				on = false;
				return null;
			}
		}
		if (ctx.state === 'running') return ctx;
		// 'suspended'（还没有用户手势）或 iOS 来电等打断后的 'interrupted'：拉起来，但这一声不排进去——
		// 挂起时时钟停在原地，排进去的声音会在恢复的那一刻一齐响。
		// 在手势回调里同步调用 resume（Safari 要求）；它在个别旧内核里会直接抛错或不返回 Promise，一并兜住。
		try { ctx.resume()?.catch?.(() => {}); } catch { /* 下次手势再试 */ }
		return null;
	};

	// 浏览器要等用户手势才放声：第一次点按或按键时就把音频拉起来（来电打断后同理）。
	// 触屏上 pointerdown 不算手势，抬起（pointerup / touchend）才算，所以几种都听。
	const unlock = () => { if (on && ctx?.state !== 'running') ready(); };
	for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) addEventListener(type, unlock, { capture: true });

	const jitter = amount => 1 + (Math.random() * 2 - 1) * amount;

	// 一个按指数衰减的正弦分音。
	function partial(ac, freq, { t, gain, decay, glide = 0 }) {
		const osc = ac.createOscillator();
		const amp = ac.createGain();
		osc.frequency.setValueAtTime(freq, t);
		if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t + decay * 2);
		amp.gain.setValueAtTime(0.0001, t);
		amp.gain.linearRampToValueAtTime(gain, t + 0.0015);
		amp.gain.exponentialRampToValueAtTime(0.0001, t + decay * 6);
		osc.connect(amp).connect(out);
		osc.start(t);
		osc.stop(t + decay * 6 + 0.02);
	}

	let noiseBuffer = null;
	function click(ac, { t, gain, cutoff = 1800, dur = 0.006 }) {
		if (!noiseBuffer) {
			noiseBuffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * 0.02), ac.sampleRate);
			const data = noiseBuffer.getChannelData(0);
			for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
		}
		const src = ac.createBufferSource();
		src.buffer = noiseBuffer;
		const hp = ac.createBiquadFilter();
		hp.type = 'highpass';
		hp.frequency.value = cutoff;
		const amp = ac.createGain();
		amp.gain.setValueAtTime(gain, t);
		amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(hp).connect(amp).connect(out);
		src.start(t);
		src.stop(t + dur + 0.01);
	}

	// 木块落在木盘上。pitch 越低越"沉"，weight 越大余音越长、低频越重。
	function knock({ delay = 0, pitch = 1, weight = 1, gain = 0.5 } = {}) {
		const ac = ready();
		if (!ac) return;
		const t = ac.currentTime + delay;
		const p = pitch * jitter(0.035);
		const modes = [[1180, 1, 0.050], [2010, 0.5, 0.032], [3170, 0.28, 0.020], [4420, 0.14, 0.011]];
		for (const [f, g, d] of modes) partial(ac, f * p * jitter(0.012), { t, gain: gain * g * 0.32, decay: d * (0.75 + 0.35 * weight) });
		partial(ac, 172 * p, { t, gain: gain * 0.55 * weight, decay: 0.022 + 0.012 * weight, glide: 0.62 });
		click(ac, { t, gain: gain * 0.45 });
	}

	// 钟声：基音加两个非整数倍分音，像小铃铛。
	function bell(freqs, { delay = 0, step = 0, gain = 0.12, decay = 0.22 } = {}) {
		const ac = ready();
		if (!ac) return;
		freqs.forEach((f, i) => {
			const t = ac.currentTime + delay + i * step;
			partial(ac, f, { t, gain, decay });
			partial(ac, f * 2.76, { t, gain: gain * 0.3, decay: decay * 0.55 });
			partial(ac, f * 5.4, { t, gain: gain * 0.1, decay: decay * 0.3 });
		});
	}

	const sounds = {
		lift() { knock({ pitch: 1.35, weight: 0.3, gain: 0.16 }); },
		place() { knock({ gain: 0.55 }); },
		// 吃子：先一记更沉的落子，紧接着被吃棋子离盘的轻响。
		capture() { knock({ pitch: 0.9, weight: 1.35, gain: 0.62 }); knock({ delay: 0.05, pitch: 1.12, weight: 0.6, gain: 0.3 }); },
		// 易位：王、车先后落下。
		castle() { knock({ gain: 0.5 }); knock({ delay: 0.12, pitch: 1.06, gain: 0.42 }); },
		promote() { knock({ gain: 0.5 }); bell([1046.5, 1318.5, 1568], { delay: 0.06, step: 0.07, gain: 0.07 }); },
		check() { bell([987.8, 1318.5], { delay: 0.04, step: 0.09, gain: 0.12, decay: 0.18 }); },
		start() { knock({ gain: 0.32, pitch: 1.05 }); knock({ delay: 0.09, gain: 0.32, pitch: 0.97 }); },
		end(result) {
			if (result === 'win') bell([523.3, 659.3, 784, 1046.5], { step: 0.11, gain: 0.12, decay: 0.32 });
			else if (result === 'lose') bell([392, 311.1], { step: 0.18, gain: 0.11, decay: 0.34 });
			else bell([523.3, 659.3], { step: 0.16, gain: 0.1, decay: 0.3 });
		},
		deny() { knock({ pitch: 0.55, weight: 0.4, gain: 0.22 }); }
	};

	// 音效只是点缀：任何 Web Audio 异常都在这里吞掉，绝不打断走子流程（音效在对局回调里播放）。
	const api = {
		set enabled(v) { on = v; },
		get enabled() { return on; }
	};
	for (const [name, play] of Object.entries(sounds)) {
		api[name] = (...args) => { try { play(...args); } catch { /* 静音继续 */ } };
	}
	return api;
}
