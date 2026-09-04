// 每个音效都是现场合成的——没有资源文件，没有加载。
export function createAudio() {
	let ctx = null;
	let on = true;

	const ready = () => {
		if (!on) return null;
		if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
		if (ctx.state === 'suspended') ctx.resume();
		return ctx;
	};

	function tone(freq, { dur = 0.08, gain = 0.04, type = 'sine', slide = 0, delay = 0 } = {}) {
		const ac = ready();
		if (!ac) return;
		const t0 = ac.currentTime + delay;
		const osc = ac.createOscillator();
		const amp = ac.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t0);
		if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
		amp.gain.setValueAtTime(0.0001, t0);
		amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
		amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
		osc.connect(amp).connect(ac.destination);
		osc.start(t0);
		osc.stop(t0 + dur + 0.02);
	}

	function noise({ dur = 0.14, gain = 0.05, cutoff = 1400, delay = 0 } = {}) {
		const ac = ready();
		if (!ac) return;
		const t0 = ac.currentTime + delay;
		const frames = Math.floor(ac.sampleRate * dur);
		const buffer = ac.createBuffer(1, frames, ac.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2.4;
		const src = ac.createBufferSource();
		src.buffer = buffer;
		const filter = ac.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.setValueAtTime(cutoff, t0);
		const amp = ac.createGain();
		amp.gain.setValueAtTime(gain, t0);
		src.connect(filter).connect(amp).connect(ac.destination);
		src.start(t0);
	}

	return {
		set enabled(v) { on = v; },
		get enabled() { return on; },
		tick() { tone(2100, { dur: 0.05, gain: 0.03 }); },
		confirm() { tone(680, { dur: 0.07, gain: 0.045 }); tone(1020, { dur: 0.09, gain: 0.04, delay: 0.06 }); },
		back() { tone(520, { dur: 0.08, gain: 0.035, slide: -180 }); },
		lift() { tone(1240, { dur: 0.05, gain: 0.025 }); },
		place() { noise({ dur: 0.13, gain: 0.07, cutoff: 1100 }); tone(180, { dur: 0.09, gain: 0.05, type: 'triangle', slide: -60 }); },
		capture() { noise({ dur: 0.22, gain: 0.10, cutoff: 2600 }); tone(120, { dur: 0.16, gain: 0.07, type: 'square', slide: -50 }); },
		check() { tone(880, { dur: 0.1, gain: 0.05 }); tone(1320, { dur: 0.14, gain: 0.045, delay: 0.09 }); },
		end(win) {
			if (win) { tone(523, { dur: 0.2, gain: 0.05 }); tone(784, { dur: 0.26, gain: 0.05, delay: 0.16 }); tone(1046, { dur: 0.4, gain: 0.045, delay: 0.34 }); }
			else { tone(392, { dur: 0.24, gain: 0.05 }); tone(294, { dur: 0.42, gain: 0.045, delay: 0.2 }); }
		},
		deny() { tone(160, { dur: 0.1, gain: 0.045, type: 'sawtooth' }); }
	};
}
