import * as THREE from 'three';
import { NOISE } from '../scene/glsl.js';

const TERRAIN = /* glsl */`
	// 起伏的积雪，在摆放棋盘的地方平成一片空地。
	float terrainH(vec2 p){
		float clearing = smoothstep(5.6, 14.0, length(p));
		float h = fbm(p * 0.048) * 3.1 + fbm(p * 0.17) * 0.46;
		h += ridged(p * 0.09) * 0.55;
		return (h - 1.35) * clearing - 0.06;
	}
`;

// 雪地：位移出的地面带着风刻的雪堆、蓝色阴影散射，
// 以及一层只有相机正好撞上晶面时才亮的闪光。
export function createGround(scene) {
	const geometry = new THREE.PlaneGeometry(220, 220, 300, 300);
	geometry.rotateX(-Math.PI / 2);

	const uniforms = {
		uTime: { value: 0 },
		uSparkle: { value: 1 }
	};

	const material = new THREE.MeshStandardMaterial({
		color: 0xb9cbe4,
		roughness: 0.82,
		metalness: 0.0
	});

	material.onBeforeCompile = shader => {
		Object.assign(shader.uniforms, uniforms);

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>
				varying vec3 vWorld;
				varying float vHeight;
				${NOISE}
				${TERRAIN}`)
			.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
				float h0 = terrainH(position.xz);
				const float E = 0.55;
				vec3 pc = vec3(position.x, h0, position.z);
				vec3 px = vec3(position.x + E, terrainH(position.xz + vec2(E, 0.0)), position.z);
				vec3 pz = vec3(position.x, terrainH(position.xz + vec2(0.0, E)), position.z + E);
				objectNormal = normalize(cross(pz - pc, px - pc));`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>
				transformed.y += h0;
				vHeight = h0;
				vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
				uniform float uTime;
				uniform float uSparkle;
				varying vec3 vWorld;
				varying float vHeight;
				${NOISE}`)
			.replace('#include <color_fragment>', `#include <color_fragment>
				// 风纹朝东北走；硬壳雪看着比新雪略暖。
				vec2 wind = vec2(0.86, 0.51);
				float streak = ridged(vec2(dot(vWorld.xz, wind) * 0.9, dot(vWorld.xz, vec2(-wind.y, wind.x)) * 0.11));
				float grain = fbm(vWorld.xz * 2.4) * 0.5 + fbm(vWorld.xz * 11.0) * 0.16;
				vec3 powder = vec3(0.92, 0.96, 1.00);
				vec3 crust  = vec3(0.74, 0.81, 0.93);
				vec3 deep   = vec3(0.40, 0.50, 0.74);
				vec3 snow = mix(crust, powder, smoothstep(0.28, 0.72, streak * 0.6 + grain));
				snow = mix(snow, deep, smoothstep(0.35, -1.5, vHeight) * 0.45);
				diffuseColor.rgb *= snow;`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
				roughnessFactor *= 0.72 + 0.34 * fbm(vWorld.xz * 3.1);`)
			.replace('#include <opaque_fragment>', `
				{
					// 晶面闪光：每格一粒候选雪晶，只有当视线向量
					// 正好对齐它随机的倾角时才点亮。
					float dist = length(vWorld - cameraPosition);
					float near = smoothstep(30.0, 6.0, dist);
					vec2 gp = vWorld.xz * 13.0;
					vec2 cell = floor(gp);
					vec2 jit = hash22(cell) - 0.5;
					float d = length(fract(gp) - 0.5 - jit * 0.72);
					float flake = smoothstep(0.13, 0.01, d);
					vec3 tilt = normalize(vec3(jit.x * 0.7, 1.0, jit.y * 0.7));
					vec3 V = normalize(cameraPosition - vWorld);
					float align = pow(max(dot(reflect(-V, tilt), normalize(vec3(-0.46, 0.13, -0.84))), 0.0), 40.0);
					float blink = pow(max(sin(uTime * 1.1 + hash21(cell) * 62.0), 0.0), 14.0);
					outgoingLight += flake * near * uSparkle * align * blink * 5.0 * vec3(0.92, 0.96, 1.05);
				}
				#include <opaque_fragment>`);
	};

	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = true;
	mesh.position.y = -0.02;
	scene.add(mesh);

	return {
		mesh,
		uniforms,
		update(_dt, time) { uniforms.uTime.value = time; },
		setQuality(cfg) { uniforms.uSparkle.value = cfg.bloom ? 1 : 0.6; }
	};
}
