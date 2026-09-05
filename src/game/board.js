import * as THREE from 'three';
import { NOISE } from '../scene/glsl.js';

const HALF = 4;

// 0x88 格号 -> 世界中心。第 8 横排在 -z，第 1 横排（白方底线）在 +z。
export function squareToWorld(sq, out = new THREE.Vector3()) {
	return out.set((sq & 15) - 3.5, 0, (sq >> 4) - 3.5);
}

export function worldToSquare(point) {
	const f = Math.floor(point.x + HALF);
	const r = Math.floor(point.z + HALF);
	if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
	return r * 16 + f;
}

function frameTexture() {
	const S = 1024;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = S;
	const ctx = canvas.getContext('2d');

	ctx.fillStyle = '#191d26';
	ctx.fillRect(0, 0, S, S);

	const grad = ctx.createLinearGradient(0, 0, S, S);
	grad.addColorStop(0, '#2a3040');
	grad.addColorStop(0.5, '#141821');
	grad.addColorStop(1, '#252b39');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, S, S);

	for (let i = 0; i < 2600; i++) {
		ctx.fillStyle = `rgba(${190 + Math.random() * 60 | 0},${200 + Math.random() * 50 | 0},255,${Math.random() * 0.05})`;
		ctx.fillRect(Math.random() * S, Math.random() * S, Math.random() * 40 + 2, 1);
	}

	// 棋盘区内缩 0.8 个单位，外框共 9.6 个单位。
	const inset = (0.8 / 9.6) * S;
	ctx.strokeStyle = 'rgba(198,220,240,.34)';
	ctx.lineWidth = 2;
	ctx.strokeRect(inset, inset, S - inset * 2, S - inset * 2);

	ctx.fillStyle = '#dbe7f4';
	ctx.font = `500 ${Math.round(S * 0.028)}px "Geist Mono", ui-monospace, monospace`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	// 贴图是平铺的，它的 v 轴和 canvas 方向相反。所以每个字符
	// 都要镜像着画——象牙读的两边上下翻转，黑曜读的两边左右翻转——
	// 这样无论棋盘转向谁，面前都有一排正立的字母和一列正立的数字。
	const stamp = (text, x, y, forBlack) => {
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(forBlack ? -1 : 1, forBlack ? 1 : -1);
		ctx.fillText(text, 0, 0);
		ctx.restore();
	};

	const step = (S - inset * 2) / 8;
	for (let i = 0; i < 8; i++) {
		const centre = inset + step * (i + 0.5);
		const letter = 'ABCDEFGH'[i];
		const rank = String(i + 1);
		stamp(letter, centre, inset * 0.5, false);
		stamp(letter, centre, S - inset * 0.5, true);
		stamp(rank, inset * 0.5, centre, false);
		stamp(rank, S - inset * 0.5, centre, true);
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

export function createBoard(scene) {
	const group = new THREE.Group();

	// 逐格状态：r 选中，g 合法，b 威胁，a 上一步。
	const data = new Uint8Array(64 * 4);
	const marks = new THREE.DataTexture(data, 8, 8, THREE.RGBAFormat);
	marks.magFilter = THREE.NearestFilter;
	marks.minFilter = THREE.NearestFilter;
	marks.needsUpdate = true;

	const uniforms = {
		uTime: { value: 0 },
		uMarks: { value: marks },
		uHover: { value: -1 },
		uHints: { value: 1 }
	};

	const surface = new THREE.MeshPhysicalMaterial({
		color: 0xffffff,
		roughness: 0.26,
		metalness: 0.0,
		clearcoat: 0.42,
		clearcoatRoughness: 0.30,
		envMapIntensity: 0.75
	});

	surface.onBeforeCompile = shader => {
		Object.assign(shader.uniforms, uniforms);

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>
				varying vec3 vWorld;`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>
				vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
				uniform float uTime;
				uniform float uHover;
				uniform float uHints;
				uniform sampler2D uMarks;
				varying vec3 vWorld;
				${NOISE}`)
			.replace('#include <color_fragment>', `#include <color_fragment>
				vec2 local = vWorld.xz + 4.0;
				vec2 cell = clamp(floor(local), 0.0, 7.0);
				vec2 f = fract(local);
				float dark = mod(cell.x + cell.y, 2.0);

				// 冰封石板：浅格是冻住的冰面，深格是石头。
				float vein = ridged(vWorld.xz * 2.6 + vec2(0.0, dark * 11.0));
				float grain = fbm(vWorld.xz * 9.0);
				vec3 pale = mix(vec3(0.86, 0.91, 0.97), vec3(0.97, 0.99, 1.00), vein * 0.8);
				pale = mix(pale, vec3(0.72, 0.82, 0.93), grain * 0.35);
				vec3 slate = mix(vec3(0.085, 0.108, 0.150), vec3(0.19, 0.23, 0.30), pow(vein, 1.7));
				slate = mix(slate, vec3(0.26, 0.31, 0.40), grain * 0.24);
				diffuseColor.rgb *= mix(pale, slate, dark);

				// 格子之间的发丝凹槽。
				vec2 edge = min(f, 1.0 - f);
				float seam = 1.0 - smoothstep(0.0, 0.022, min(edge.x, edge.y));
				diffuseColor.rgb *= 1.0 - seam * 0.45;`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
				{
					vec2 lp = vWorld.xz + 4.0;
					float dk = mod(floor(lp.x) + floor(lp.y), 2.0);
					roughnessFactor = mix(0.23, 0.44, dk) + fbm(vWorld.xz * 14.0) * 0.12;
				}`)
			.replace('#include <opaque_fragment>', `
				{
					vec4 mk = texture2D(uMarks, (cell + 0.5) / 8.0);
					float idx = cell.y * 8.0 + cell.x;
					vec2 c = f - 0.5;
					float d = length(c);
					float pulse = 0.5 + 0.5 * sin(uTime * 2.6);

					vec3 glow = vec3(0.0);

					// 上一步：在两格上铺一层中性色。
					glow += mk.a * vec3(0.24, 0.28, 0.34) * (0.40 + 0.22 * pulse);

					// 合法落点：柔和圆点，边缘清晰。
					float disc = smoothstep(0.19, 0.11, d);
					float rim = smoothstep(0.215, 0.185, d) - smoothstep(0.185, 0.155, d);
					glow += mk.g * uHints * (disc * 0.5 + rim * 1.35) * vec3(0.52, 0.79, 1.00);

					// 可吃或将军：贴着格边的环。
					float ring = smoothstep(0.46, 0.42, max(abs(c.x), abs(c.y))) - smoothstep(0.42, 0.37, max(abs(c.x), abs(c.y)));
					glow += mk.b * uHints * ring * (0.9 + 0.5 * pulse) * vec3(1.00, 0.48, 0.40);

					// 被拿起的棋子：整格呼吸。
					glow += mk.r * (0.30 + 0.18 * pulse) * vec3(0.88, 0.94, 1.00);

					if (abs(idx - uHover) < 0.5) {
						float hoverRing = smoothstep(0.48, 0.44, max(abs(c.x), abs(c.y)));
						glow += hoverRing * 0.16 * vec3(0.86, 0.93, 1.0);
					}

					outgoingLight += glow;
				}
				#include <opaque_fragment>`);
	};

	const field = new THREE.Mesh(new THREE.PlaneGeometry(8, 8, 1, 1), surface);
	field.geometry.rotateX(-Math.PI / 2);
	field.position.y = 0.012;
	field.receiveShadow = true;
	group.add(field);

	// 承载字母列和数字行的边框。
	const outer = 4.8, inner = 4.0;
	const shape = new THREE.Shape()
		.moveTo(-outer, -outer).lineTo(outer, -outer).lineTo(outer, outer).lineTo(-outer, outer).lineTo(-outer, -outer);
	const hole = new THREE.Path()
		.moveTo(-inner, -inner).lineTo(-inner, inner).lineTo(inner, inner).lineTo(inner, -inner).lineTo(-inner, -inner);
	shape.holes.push(hole);

	const frameGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.34, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 2 });
	frameGeo.rotateX(-Math.PI / 2);
	const pos = frameGeo.attributes.position;
	const uv = new Float32Array(pos.count * 2);
	for (let i = 0; i < pos.count; i++) {
		uv[i * 2] = (pos.getX(i) + outer) / (outer * 2);
		uv[i * 2 + 1] = (pos.getZ(i) + outer) / (outer * 2);
	}
	frameGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

	const frame = new THREE.Mesh(frameGeo, new THREE.MeshStandardMaterial({
		map: frameTexture(),
		roughness: 0.52,
		metalness: 0.22
	}));
	frame.position.y = 0.005;
	frame.castShadow = true;
	frame.receiveShadow = true;
	group.add(frame);

	// 底下的石板，让棋盘看着像凿出来的石头，而不是漂着的平面。
	const slab = new THREE.Mesh(
		new THREE.BoxGeometry(9.68, 0.5, 9.68),
		new THREE.MeshStandardMaterial({ color: 0x30364a, roughness: 0.88 })
	);
	slab.position.y = -0.26;
	slab.castShadow = true;
	slab.receiveShadow = true;
	group.add(slab);

	scene.add(group);

	// ── 实体网格提示（fallback）─────────────────────────────
	// 棋盘高亮走片元着色器 + DataTexture，在 mediump 精度的手机 GPU
	// 上 UV/格内坐标会漂移，导致落点圆点和吃子环整个消失。
	// 这里用真实几何体重画同一套提示，不碰浮点精度，任何设备都稳。
	const overlay = new THREE.Group();
	overlay.position.y = 0.02; // 略高于冰面，避免 z-fighting
	group.add(overlay);

	const geoDot = new THREE.CircleGeometry(0.14, 24).rotateX(-Math.PI / 2);
	const geoRing = new THREE.RingGeometry(0.36, 0.45, 32).rotateX(-Math.PI / 2);
	const geoSquare = new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);

	const matDot = new THREE.MeshBasicMaterial({ color: 0x7fc4ff, transparent: true, opacity: 0.9, depthWrite: false });
	const matRing = new THREE.MeshBasicMaterial({ color: 0xff8563, transparent: true, opacity: 0.95, depthWrite: false });
	const matSel = new THREE.MeshBasicMaterial({ color: 0xdcecff, transparent: true, opacity: 0.34, depthWrite: false });
	const matLast = new THREE.MeshBasicMaterial({ color: 0xf5e9b8, transparent: true, opacity: 0.30, depthWrite: false });

	function overlayMesh(geo, mat, x, y, z) {
		const m = new THREE.Mesh(geo, mat);
		m.position.set(x, y, z);
		m.renderOrder = 4;
		m.visible = false;
		overlay.add(m);
		return m;
	}

	// 每格四类提示各一份，按需显示/隐藏，避免每步 new。
	const overlayCells = [];
	for (let i = 0; i < 64; i++) {
		const r = i >> 3, f = i & 7;
		const x = f - 3.5, z = r - 3.5;
		overlayCells.push({
			sel: overlayMesh(geoSquare, matSel, x, 0, z),
			dot: overlayMesh(geoDot, matDot, x, 0.001, z),
			ring: overlayMesh(geoRing, matRing, x, 0.002, z),
			last: overlayMesh(geoSquare, matLast, x, -0.001, z)
		});
	}

	let overlayOn = false;
	let hintsOn = true;

	function syncOverlay() {
		for (let i = 0; i < 64; i++) {
			const cell = overlayCells[i];
			const base = i * 4;
			cell.sel.visible = overlayOn && data[base + 0] > 40;
			cell.dot.visible = overlayOn && hintsOn && data[base + 1] > 40;
			cell.ring.visible = overlayOn && hintsOn && data[base + 2] > 40;
			cell.last.visible = overlayOn && data[base + 3] > 40;
		}
	}

	function setMark(sq, channel, value) {
		const f = sq & 15, r = sq >> 4;
		data[(r * 8 + f) * 4 + channel] = Math.round(value * 255);
		marks.needsUpdate = true;
		syncOverlay();
	}

	function clearMarks(channels = [0, 1, 2, 3]) {
		for (let i = 0; i < 64; i++) for (const c of channels) data[i * 4 + c] = 0;
		marks.needsUpdate = true;
		syncOverlay();
	}

	return {
		group, field, uniforms,
		setMark, clearMarks,
		setHover(sq) { uniforms.uHover.value = sq < 0 ? -1 : (sq >> 4) * 8 + (sq & 15); },
		setHints(on) { hintsOn = on; uniforms.uHints.value = on ? 1 : 0; syncOverlay(); },
		// 强制启用实体网格提示（触屏/移动端自动开，也可手动开）。
		setOverlay(on) { overlayOn = on; syncOverlay(); },
		get overlay() { return overlayOn; },
		update(_dt, time) { uniforms.uTime.value = time; }
	};
}
