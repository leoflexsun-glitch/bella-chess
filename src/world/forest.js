import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE } from '../scene/glsl.js';

const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// 一棵针叶树合并成单个几何体，整片林子一次绘制调用。
function conifer(tiers, height, spread) {
	const parts = [];
	const trunk = new THREE.CylinderGeometry(0.055 * spread, 0.11 * spread, height * 0.42, 6, 1, true);
	trunk.translate(0, height * 0.21, 0);
	parts.push(trunk);

	for (let i = 0; i < tiers; i++) {
		const t = i / (tiers - 1);
		const radius = spread * (0.62 - t * 0.42);
		const tall = height * (0.34 - t * 0.12);
		const cone = new THREE.ConeGeometry(radius, tall, 8, 1, true);
		cone.translate(0, height * (0.24 + t * 0.62), 0);
		parts.push(cone);
	}
	const merged = mergeGeometries(parts, false);
	parts.forEach(p => p.dispose());
	return merged;
}

function forestMaterial({ color, snow, sway }) {
	const uniforms = { uTime: { value: 0 }, uSnow: { value: snow }, uSway: { value: sway } };
	const material = new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0.0, flatShading: true });

	material.onBeforeCompile = shader => {
		Object.assign(shader.uniforms, uniforms);

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>
				attribute float aSeed;
				uniform float uTime;
				uniform float uSway;
				varying vec3 vWorld;
				varying vec3 vWorldNormal;
				varying float vSeed;`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>
				float gust = sin(uTime * 0.72 + aSeed * 6.28) * 0.6 + sin(uTime * 1.63 + aSeed * 11.0) * 0.4;
				float lever = pow(max(position.y, 0.0), 1.7);
				transformed.x += gust * uSway * lever;
				transformed.z += gust * uSway * lever * 0.55;
				vSeed = aSeed;
				vWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
				vWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`);

		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
				uniform float uSnow;
				varying vec3 vWorld;
				varying vec3 vWorldNormal;
				varying float vSeed;
				${NOISE}`)
			.replace('#include <color_fragment>', `#include <color_fragment>
				// 针叶随树冠深度变暗；雪积在朝上的面上。
				float depth = fbm(vWorld.xz * 1.7 + vWorld.y * 0.5);
				diffuseColor.rgb *= 0.72 + 0.5 * depth;
				diffuseColor.rgb *= 0.86 + 0.28 * hash11(vSeed * 37.0);
				float lie = smoothstep(0.24, 0.82, vWorldNormal.y);
				float breakup = smoothstep(0.34, 0.66, fbm(vWorld.xz * 5.5 + vWorld.y * 2.2));
				float cap = lie * mix(0.55, 1.0, breakup) * uSnow;
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.87, 0.99), cap);`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
				roughnessFactor = mix(roughnessFactor, 0.62, smoothstep(0.3, 0.9, vWorldNormal.y) * uSnow);`);
	};

	return { material, uniforms };
}

export function createForest(scene, cfg) {
	const random = rng(20260114);
	const group = new THREE.Group();

	const variants = [conifer(5, 6.4, 1.15), conifer(6, 8.9, 1.0), conifer(4, 4.6, 1.35)];
	const canopy = forestMaterial({ color: 0x24443c, snow: 1.0, sway: 0.02 });

	const buckets = variants.map(() => []);

	const count = cfg.trees;
	let guard = 0;
	while (buckets.flat().length < count && guard++ < count * 12) {
		const angle = random() * Math.PI * 2;
		const radius = 13.5 + Math.pow(random(), 0.62) * 62;
		const x = Math.cos(angle) * radius;
		const z = Math.sin(angle) * radius;
		// 在西北方向留一条视线走廊，让太阳照得到棋盘。
		const gap = Math.abs(Math.atan2(z, x) - 2.6);
		if (gap < 0.22 && radius < 34) continue;
		const v = random() < 0.5 ? 0 : random() < 0.62 ? 1 : 2;
		buckets[v].push({
			x, z,
			scale: 0.72 + random() * 0.75,
			lean: 0.82 + random() * 0.42,   // 有的林子瘦高，有的矮壮
			spin: random() * Math.PI * 2,
			tilt: (random() - 0.5) * 0.09,
			seed: random()
		});
	}

	const dummy = new THREE.Object3D();
	variants.forEach((geometry, i) => {
		const list = buckets[i];
		if (!list.length) return;
		const mesh = new THREE.InstancedMesh(geometry, canopy.material, list.length);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		const seeds = new Float32Array(list.length);
		list.forEach((t, k) => {
			dummy.position.set(t.x, -0.15, t.z);
			dummy.rotation.set(t.tilt, t.spin, t.tilt * 0.6);
			dummy.scale.set(t.scale, t.scale * t.lean, t.scale);
			dummy.updateMatrix();
			mesh.setMatrixAt(k, dummy.matrix);
			seeds[k] = t.seed;
		});
		geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
		mesh.instanceMatrix.needsUpdate = true;
		mesh.frustumCulled = false;
		group.add(mesh);
	});

	scene.add(group);

	return {
		group,
		update(_dt, time) { canopy.uniforms.uTime.value = time; }
	};
}
