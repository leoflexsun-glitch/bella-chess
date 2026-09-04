import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPost } from './post.js';

export const QUALITY = {
	ultra: { pixel: 2, shadow: 2560, snow: 9000, trees: 420, bloom: true, grade: true },
	high: { pixel: 1.75, shadow: 1792, snow: 5200, trees: 300, bloom: true, grade: true },
	low: { pixel: 1.15, shadow: 0, snow: 2200, trees: 170, bloom: false, grade: true }
};

const VIEWS = {
	seat: { radius: 12.6, polar: 1.04, yaw: 0.30, label: '对坐' },
	high: { radius: 15.2, polar: 0.80, yaw: 0.16, label: '高位' },
	over: { radius: 12.6, polar: 0.14, yaw: 0, label: '俯瞰' }
};

// 二维模式：同一副 3D 棋盘，只是被钉在正上方。90° 俯瞰、
// 视野收窄（棋盘铺满画面），并且锁定轨道控制。
// 往 z 轴偏 0.35：太小会让 up 向量与视线平行导致万向锁，
// 这个偏移同时决定"上"是棋盘的远端（白方视角）。
const TOPDOWN = { radius: 15.6, offset: 0.35, fov: 30 };

export function createStage(canvas, quality = 'high') {
	const cfg = QUALITY[quality] || QUALITY.high;

	// 隐藏或尚未布局的页面可能报出零视口，
	// 那会让每个渲染目标都不完整。
	const viewport = () => [Math.max(1, innerWidth), Math.max(1, innerHeight)];

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
	// 无 GPU 的软件渲染（沙盒/远程无头环境）扛不住高像素比，
	// 直接锁 1——反正本来就跑不满帧。
	const softGL = (renderer.getContext().getParameter(renderer.getContext().RENDERER) || '').match(/swiftshader|llvmpipe|software/i);
	renderer.setPixelRatio(softGL ? 1 : Math.min(devicePixelRatio, cfg.pixel));
	renderer.setSize(...viewport());
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.94;
	renderer.shadowMap.enabled = cfg.shadow > 0;
	renderer.shadowMap.type = THREE.PCFShadowMap;

	const scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2(0x18223c, 0.0205);

	const camera = new THREE.PerspectiveCamera(42, viewport()[0] / viewport()[1], 0.1, 400);
	camera.position.set(0, 7.4, 10.6);

	const controls = new OrbitControls(camera, canvas);
	controls.target.set(0, 0.55, 0);
	controls.enableDamping = true;
	controls.dampingFactor = 0.07;
	controls.rotateSpeed = 0.62;
	controls.zoomSpeed = 0.7;
	controls.enablePan = false;
	controls.minDistance = 6.4;
	controls.maxDistance = 24;
	controls.minPolarAngle = 0.1;
	controls.maxPolarAngle = 1.32;
	controls.enabled = false;

	const post = createPost(renderer, scene, camera, cfg);
	const updates = [];
	const listeners = { quality: [] };

	const state = {
		quality,
		cfg,
		attract: true,
		azimuth: 0,
		view: 'seat',
		flipped: false,
		topdown: false,
		frames: [],
		measured: false
	};

	function resize() {
		const [w, h] = viewport();
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
		post.setSize(w, h);
	}
	addEventListener('resize', resize);

	// 把相机平滑地送到命名预设位，之后不再与 OrbitControls 打架。
	let glide = null;
	function moveTo(view, { instant = false } = {}) {
		state.view = view;
		let target;
		if (state.topdown) {
			const off = state.flipped ? -TOPDOWN.offset : TOPDOWN.offset;
			target = new THREE.Vector3(controls.target.x, controls.target.y + TOPDOWN.radius, controls.target.z + off);
		} else {
			const preset = VIEWS[view] || VIEWS.seat;
			const azimuth = (preset.yaw || 0) + (state.flipped ? Math.PI : 0);
			target = new THREE.Vector3(
				Math.sin(azimuth) * Math.sin(preset.polar),
				Math.cos(preset.polar),
				Math.cos(azimuth) * Math.sin(preset.polar)
			).multiplyScalar(preset.radius).add(controls.target);
		}
		if (instant) { camera.position.copy(target); controls.update(); return; }
		glide = { from: camera.position.clone(), to: target, t: 0, dur: 1.05 };
	}

	function step(dt) {
		if (glide) {
			glide.t = Math.min(1, glide.t + dt / glide.dur);
			const e = glide.t < 0.5 ? 4 * glide.t ** 3 : 1 - (-2 * glide.t + 2) ** 3 / 2;
			camera.position.lerpVectors(glide.from, glide.to, e);
			if (glide.t >= 1) glide = null;
			controls.update();
			return;
		}

		if (state.attract) {
			state.azimuth += dt * 0.032;
			const r = 14.4 + Math.sin(state.azimuth * 0.6) * 1.8;
			camera.position.set(
				Math.sin(state.azimuth) * r,
				4.2 + Math.sin(state.azimuth * 0.43) * 1.7,
				Math.cos(state.azimuth) * r
			);
		}

		controls.update();

		// 俯瞰时把相机一直按在正上方。轨道已禁用，这里只需
		// 覆盖 glide 结束后的姿态，保证每帧都钉死。
		if (state.topdown && !state.attract) {
			const off = state.flipped ? -TOPDOWN.offset : TOPDOWN.offset;
			camera.position.set(controls.target.x, controls.target.y + TOPDOWN.radius, controls.target.z + off);
			camera.lookAt(controls.target);
		}

		// 菜单占着画面左侧。把视线稍微瞄向棋盘左侧，
		// 棋盘就留在空出来的右半边——而且这必须放在
		// controls.update() 之后，因为它总会把相机重新对准 target。
		if (state.attract) {
			const off = new THREE.Vector3().subVectors(controls.target, camera.position).cross(camera.up).normalize();
			camera.lookAt(controls.target.clone().addScaledVector(off, -2.7));
		}
	}

	function measure(ms) {
		if (state.measured || state.quality === 'low') return;
		state.frames.push(ms);
		if (state.frames.length < 100) return;
		state.measured = true;
		const median = state.frames.slice(20).sort((a, b) => a - b)[Math.floor((state.frames.length - 20) / 2)];
		if (median > 27) setQuality(state.quality === 'ultra' ? 'high' : 'low', true);
	}

	function setQuality(next, automatic = false) {
		if (next === state.quality) return;
		state.quality = next;
		state.cfg = QUALITY[next];
		state.frames = [];
		state.measured = automatic ? false : state.measured;
		renderer.setPixelRatio(Math.min(devicePixelRatio, state.cfg.pixel));
		renderer.shadowMap.enabled = state.cfg.shadow > 0;
		post.setQuality(state.cfg);
		listeners.quality.forEach(fn => fn(next, automatic));
	}

	let last = performance.now();
	let time = 0;

	function frame(dt) {
		time += dt;
		step(dt);
		for (const fn of updates) fn(dt, time);
		post.render(dt);
	}

	renderer.setAnimationLoop(() => {
		const now = performance.now();
		frame(Math.min((now - last) / 1000, 0.05));
		measure(now - last);
		last = now;
	});

	return {
		renderer, scene, camera, controls, post, state,
		onUpdate: fn => updates.push(fn),
		onQuality: fn => listeners.quality.push(fn),
		setQuality,
		moveTo,
		setAttract(on) {
			state.attract = on;
			controls.enabled = !on && !state.topdown;
			if (!on) moveTo(state.view);
		},
		flip() {
			state.flipped = !state.flipped;
			moveTo(state.view);
			return state.flipped;
		},
		// 俯瞰（二维）模式：钉住相机、收窄视野、锁定轨道。
		setTopDown(on) {
			if (state.topdown === on) return;
			state.topdown = on;
			camera.fov = on ? TOPDOWN.fov : 42;
			camera.updateProjectionMatrix();
			// 完全禁用轨道——否则 minPolarAngle 会把正上方的相机钳回去，
			// 和钉住逻辑打架，拾取坐标全歪。
			controls.enabled = false;
			controls.enableZoom = !on;
			controls.enableRotate = !on;
			controls.enableDamping = !on;
			moveTo(state.view, { instant: true });
			if (on) {
				const off = state.flipped ? -TOPDOWN.offset : TOPDOWN.offset;
				camera.position.set(controls.target.x, controls.target.y + TOPDOWN.radius, controls.target.z + off);
				camera.lookAt(controls.target);
			}
		},
		cycleView() {
			const order = Object.keys(VIEWS);
			const next = order[(order.indexOf(state.view) + 1) % order.length];
			moveTo(next);
			return VIEWS[next].label;
		}
	};
}
