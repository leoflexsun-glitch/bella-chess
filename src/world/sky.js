import * as THREE from 'three';
import { NOISE } from '../scene/glsl.js';

// 天穹着色器：分层的暮色渐变、一轮穿透雪雾的低日、
// 只在上三分之一存活的星星，以及缓慢飘动的极光带。
export function createSky(scene, sunDir) {
	const uniforms = {
		uTime: { value: 0 },
		uSun: { value: sunDir.clone() },
		uHorizon: { value: new THREE.Color(0x5f7ba6) },
		uZenith: { value: new THREE.Color(0x050916) },
		uHaze: { value: new THREE.Color(0x1a2440) },
		uAurora: { value: 0.85 }
	};

	const material = new THREE.ShaderMaterial({
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
		uniforms,
		vertexShader: /* glsl */`
			varying vec3 vDir;
			void main(){
				vDir = normalize(position);
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */`
			uniform float uTime;
			uniform vec3 uSun, uHorizon, uZenith, uHaze;
			uniform float uAurora;
			varying vec3 vDir;
			${NOISE}

			void main(){
				vec3 dir = normalize(vDir);
				float up = clamp(dir.y, -1.0, 1.0);

				vec3 col = mix(uHorizon, uZenith, pow(clamp(up * 1.18 + 0.06, 0.0, 1.0), 0.62));
				col = mix(col, uHaze, smoothstep(0.30, -0.06, up) * 0.72);

				// 破碎的云层，朝地平线方向压扁。
				vec2 cp = dir.xz / max(abs(up) + 0.16, 0.16);
				float deck = fbm(cp * 0.85 + vec2(uTime * 0.004, uTime * 0.0016));
				deck = smoothstep(0.42, 0.86, deck) * smoothstep(-0.02, 0.34, up);
				col = mix(col, vec3(0.20, 0.25, 0.36), deck * 0.66);

				// 极光：两条被噪声折弯的竖直光带，只在北面。
				float north = smoothstep(0.1, 0.9, -dir.z) * smoothstep(-0.02, 0.42, up);
				float band = 0.0;
				for (int i = 0; i < 2; i++){
					float k = float(i);
					float wob = fbm(vec2(dir.x * 2.4 + k * 5.0, uTime * 0.045 + k)) * 0.42;
					float centre = 0.30 + k * 0.16 + wob;
					band += exp(-pow((up - centre) * 7.5, 2.0)) * (0.65 - k * 0.22);
				}
				float curtain = band * north * uAurora * (0.55 + 0.45 * fbm(vec2(dir.x * 6.0, uTime * 0.11)));
				col += curtain * vec3(0.16, 0.62, 0.44) + curtain * curtain * vec3(0.24, 0.16, 0.42);

				// 星星，被云层和近地辉光筛得稀疏。
				vec3 grid = floor(dir * 190.0);
				float star = hash31(grid);
				float twinkle = 0.55 + 0.45 * sin(uTime * 2.1 + star * 42.0);
				float mag = smoothstep(0.9975, 1.0, star) * smoothstep(0.06, 0.55, up);
				col += mag * twinkle * (1.0 - deck) * vec3(0.85, 0.91, 1.0) * 1.6;

				// 太阳圆盘，以及它透过雾霭的辉光。
				float sd = max(dot(dir, normalize(uSun)), 0.0);
				col += vec3(1.00, 0.86, 0.66) * pow(sd, 1400.0) * 5.0;
				col += vec3(0.95, 0.76, 0.58) * pow(sd, 8.0) * 0.30;
				col += vec3(0.62, 0.72, 0.92) * pow(sd, 2.2) * 0.08;

				gl_FragColor = vec4(col, 1.0);
			}
		`
	});

	const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 32), material);
	dome.frustumCulled = false;
	scene.add(dome);

	return {
		dome,
		uniforms,
		update(_dt, time) { uniforms.uTime.value = time; }
	};
}
