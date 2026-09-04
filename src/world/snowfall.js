import * as THREE from 'three';

const BOX = 52;
const CEILING = 26;

// 降雪完全在顶点着色器里完成：每片雪花按自己的相位飘移，
// 并绕着一个跟随相机的盒子回卷，所以雪场没有尽头。
export function createSnowfall(scene, cfg) {
	const uniforms = {
		uTime: { value: 0 },
		uCam: { value: new THREE.Vector3() },
		uBox: { value: BOX },
		uCeil: { value: CEILING },
		uDensity: { value: 1 },
		uPixel: { value: Math.min(devicePixelRatio, 2) }
	};

	const material = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms,
		vertexShader: /* glsl */`
			attribute vec4 aSeed;   // 尺寸、落速、摆幅、相位
			uniform float uTime, uBox, uCeil, uDensity, uPixel;
			uniform vec3 uCam;
			varying float vAlpha;
			varying float vSpin;

			void main(){
				vec3 p = position;
				float phase = aSeed.w * 6.2831;

				p.y = mod(p.y - uTime * aSeed.y, uCeil);
				p.x += sin(uTime * 0.55 + phase) * aSeed.z + uTime * 0.42;
				p.z += cos(uTime * 0.41 + phase * 1.7) * aSeed.z * 0.8 + uTime * 0.24;

				// 让水平雪场绕相机回卷。
				vec2 rel = p.xz - uCam.xz;
				rel = mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
				vec3 world = vec3(uCam.x + rel.x, p.y, uCam.z + rel.y);

				vec4 mv = viewMatrix * vec4(world, 1.0);
				float dist = -mv.z;
				gl_Position = projectionMatrix * mv;
				gl_PointSize = min(aSeed.x * uPixel * (22.0 / max(dist, 1.2)), 22.0 * uPixel);

				float near = smoothstep(0.8, 4.0, dist);
				float far = 1.0 - smoothstep(20.0, 42.0, dist);
				vAlpha = near * far * uDensity * (0.26 + 0.42 * aSeed.w);
				vSpin = phase;
			}
		`,
		fragmentShader: /* glsl */`
			varying float vAlpha;
			varying float vSpin;
			void main(){
				vec2 uv = gl_PointCoord - 0.5;
				float d = length(uv);
				if (d > 0.5) discard;
				float core = smoothstep(0.5, 0.06, d);
				// 六条淡臂，让大雪花看着像晶体而不是圆点。
				float a = atan(uv.y, uv.x) + vSpin;
				float arms = 0.14 * pow(max(cos(a * 3.0), 0.0), 6.0) * smoothstep(0.5, 0.12, d);
				float alpha = (core * 0.9 + arms) * vAlpha;
				gl_FragColor = vec4(vec3(0.94, 0.97, 1.0), alpha);
			}
		`
	});

	let points = null;

	function build(count) {
		points?.geometry.dispose();
		const positions = new Float32Array(count * 3);
		const seeds = new Float32Array(count * 4);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = (Math.random() - 0.5) * BOX;
			positions[i * 3 + 1] = Math.random() * CEILING;
			positions[i * 3 + 2] = (Math.random() - 0.5) * BOX;
			const big = Math.random() ** 3;
			seeds[i * 4] = 1.3 + big * 3.6;
			seeds[i * 4 + 1] = 0.75 + Math.random() * 1.5 + big * 0.6;
			seeds[i * 4 + 2] = 0.25 + Math.random() * 1.3;
			seeds[i * 4 + 3] = Math.random();
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
		geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
		if (points) points.geometry = geometry;
		else {
			points = new THREE.Points(geometry, material);
			points.frustumCulled = false;
			points.renderOrder = 3;
			scene.add(points);
		}
	}

	build(cfg.snow);

	return {
		get points() { return points; },
		uniforms,
		update(_dt, time, camera) {
			uniforms.uTime.value = time;
			uniforms.uCam.value.copy(camera.position);
		},
		setDensity(scale) { uniforms.uDensity.value = scale; points.visible = scale > 0; },
		setQuality(next) {
			uniforms.uPixel.value = Math.min(devicePixelRatio, next.pixel);
			build(next.snow);
		}
	};
}
