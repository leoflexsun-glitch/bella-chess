import * as THREE from 'three';

const MAX = 900;

// 棋盘上所有爆发共用一个循环复用的点缓冲：棋子落地溅起的雪，
// 以及被吃棋子留下的飞屑。
export function createBursts(scene) {
	const positions = new Float32Array(MAX * 3);
	const velocity = new Float32Array(MAX * 3);
	const colors = new Float32Array(MAX * 3);
	const params = new Float32Array(MAX * 3); // birth, life, size

	for (let i = 0; i < MAX; i++) params[i * 3 + 1] = -1;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('aVel', new THREE.BufferAttribute(velocity, 3));
	geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('aParam', new THREE.BufferAttribute(params, 3));
	geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);

	const uniforms = { uTime: { value: 0 }, uPixel: { value: Math.min(devicePixelRatio, 2) } };

	const material = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms,
		vertexShader: /* glsl */`
			attribute vec3 aVel;
			attribute vec3 aColor;
			attribute vec3 aParam;
			uniform float uTime, uPixel;
			varying vec3 vColor;
			varying float vFade;

			void main(){
				float age = uTime - aParam.x;
				float life = aParam.y;
				if (life <= 0.0 || age < 0.0 || age > life){
					gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
					gl_PointSize = 0.0;
					vFade = 0.0;
					return;
				}
				float t = age / life;
				vec3 p = position + aVel * age;
				p.y -= 1.7 * age * age;
				vec4 mv = modelViewMatrix * vec4(p, 1.0);
				gl_Position = projectionMatrix * mv;
				gl_PointSize = aParam.z * uPixel * (34.0 / max(-mv.z, 0.6)) * (1.0 - t * 0.55);
				vColor = aColor;
				vFade = (1.0 - t) * smoothstep(0.0, 0.08, t);
			}
		`,
		fragmentShader: /* glsl */`
			varying vec3 vColor;
			varying float vFade;
			void main(){
				float d = length(gl_PointCoord - 0.5);
				if (d > 0.5) discard;
				gl_FragColor = vec4(vColor, smoothstep(0.5, 0.05, d) * vFade);
			}
		`
	});

	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false;
	points.renderOrder = 4;
	scene.add(points);

	let cursor = 0;
	let time = 0;

	function emit(origin, count, { spread = 1.4, rise = 1.5, color = new THREE.Color(0xdcecff), size = 5, life = 0.85 } = {}) {
		for (let i = 0; i < count; i++) {
			const k = cursor;
			cursor = (cursor + 1) % MAX;
			const a = Math.random() * Math.PI * 2;
			const r = Math.random() ** 0.5;
			positions[k * 3] = origin.x + Math.cos(a) * r * 0.18;
			positions[k * 3 + 1] = origin.y + Math.random() * 0.06;
			positions[k * 3 + 2] = origin.z + Math.sin(a) * r * 0.18;
			velocity[k * 3] = Math.cos(a) * r * spread;
			velocity[k * 3 + 1] = rise * (0.35 + Math.random() * 0.9);
			velocity[k * 3 + 2] = Math.sin(a) * r * spread;
			colors[k * 3] = color.r;
			colors[k * 3 + 1] = color.g;
			colors[k * 3 + 2] = color.b;
			params[k * 3] = time;
			params[k * 3 + 1] = life * (0.6 + Math.random() * 0.7);
			params[k * 3 + 2] = size * (0.5 + Math.random());
		}
		geometry.attributes.position.needsUpdate = true;
		geometry.attributes.aVel.needsUpdate = true;
		geometry.attributes.aColor.needsUpdate = true;
		geometry.attributes.aParam.needsUpdate = true;
	}

	return {
		points,
		emit,
		update(_dt, now) { time = now; uniforms.uTime.value = now; },
		setQuality(cfg) { uniforms.uPixel.value = Math.min(devicePixelRatio, cfg.pixel); }
	};
}
