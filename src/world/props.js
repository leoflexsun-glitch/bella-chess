import * as THREE from 'three';
import { NOISE } from '../scene/glsl.js';

const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// 雪落在一切朝天的面上。石头和倒木都用它。
function weather(material, { amount = 1, scale = 3.0 } = {}) {
	material.onBeforeCompile = shader => {
		shader.uniforms.uCap = { value: amount };
		shader.uniforms.uCapScale = { value: scale };
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>
				varying vec3 vWorld;
				varying vec3 vWorldNormal;`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>
				vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
				vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
				uniform float uCap, uCapScale;
				varying vec3 vWorld;
				varying vec3 vWorldNormal;
				${NOISE}`)
			.replace('#include <color_fragment>', `#include <color_fragment>
				float lie = smoothstep(0.18, 0.74, vWorldNormal.y);
				float edge = smoothstep(0.35, 0.68, fbm(vWorld.xz * uCapScale + vWorld.y * 1.4));
				float cap = lie * mix(0.4, 1.0, edge) * uCap;
				diffuseColor.rgb *= 0.72 + 0.5 * fbm(vWorld.xz * 6.0 + vWorld.y * 3.0);
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.94, 1.0), cap);`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
				roughnessFactor = mix(roughnessFactor, 0.68, smoothstep(0.25, 0.85, vWorldNormal.y) * uCap);`);
	};
	return material;
}

function lantern(x, z, facing) {
	const group = new THREE.Group();
	const wood = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.92 });
	weather(wood, { amount: 0.85, scale: 5 });

	const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 3.1, 7), wood);
	post.position.y = 1.55;
	post.castShadow = true;
	group.add(post);

	const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.07), wood);
	arm.position.set(0.26, 3.0, 0);
	arm.castShadow = true;
	group.add(arm);

	const cage = new THREE.Mesh(
		new THREE.CylinderGeometry(0.16, 0.19, 0.34, 6),
		new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 0.72, metalness: 0.5 })
	);
	cage.position.set(0.52, 2.68, 0);
	group.add(cage);

	const hood = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.18, 6), wood);
	hood.position.set(0.52, 2.93, 0);
	group.add(hood);

	const flame = new THREE.Mesh(
		new THREE.SphereGeometry(0.085, 12, 10),
		new THREE.MeshBasicMaterial({ color: 0xffcf90 })
	);
	flame.position.set(0.52, 2.66, 0);
	group.add(flame);

	const halo = new THREE.Sprite(new THREE.SpriteMaterial({
		map: haloTexture(),
		color: 0xffb765,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false
	}));
	halo.scale.setScalar(1.9);
	halo.position.copy(flame.position);
	group.add(halo);

	group.position.set(x, 0, z);
	group.rotation.y = facing;
	return { group, flame, halo };
}

let haloMap = null;
function haloTexture() {
	if (haloMap) return haloMap;
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d');
	const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	grad.addColorStop(0, 'rgba(255,238,210,1)');
	grad.addColorStop(0.25, 'rgba(255,190,120,.55)');
	grad.addColorStop(1, 'rgba(255,170,90,0)');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, size, size);
	haloMap = new THREE.CanvasTexture(canvas);
	haloMap.colorSpace = THREE.SRGBColorSpace;
	return haloMap;
}

export function createProps(scene) {
	const random = rng(77003);
	const group = new THREE.Group();

	const stone = weather(new THREE.MeshStandardMaterial({ color: 0x50596b, roughness: 0.95 }), { amount: 0.55, scale: 2.2 });

	// 一圈巨石，把雪堆挡在空地之外。
	const rockGeo = new THREE.IcosahedronGeometry(1, 1);
	const pos = rockGeo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const n = 0.66 + Math.random() * 0.5;
		pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.72, pos.getZ(i) * n);
	}
	rockGeo.computeVertexNormals();

	const rocks = new THREE.InstancedMesh(rockGeo, stone, 26);
	rocks.castShadow = true;
	rocks.receiveShadow = true;
	const dummy = new THREE.Object3D();
	for (let i = 0; i < 26; i++) {
		const angle = (i / 26) * Math.PI * 2 + random() * 0.2;
		const radius = 9.4 + random() * 3.4;
		dummy.position.set(Math.cos(angle) * radius, -0.5 + random() * 0.35, Math.sin(angle) * radius);
		dummy.rotation.set(random(), random() * 6.28, random() * 0.5);
		dummy.scale.setScalar(0.5 + random() * 1.25);
		dummy.updateMatrix();
		rocks.setMatrixAt(i, dummy.matrix);
	}
	rocks.instanceMatrix.needsUpdate = true;
	group.add(rocks);

	// 两根半埋的倒木。
	const timber = weather(new THREE.MeshStandardMaterial({ color: 0x362c24, roughness: 0.96 }), { amount: 0.95, scale: 4 });
	for (const [x, z, spin, len] of [[-9.6, -6.2, 0.7, 6.4], [8.2, 7.4, -1.15, 4.8]]) {
		const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, len, 9), timber);
		log.rotation.set(Math.PI / 2, 0, spin);
		log.position.set(x, -0.16, z);
		log.castShadow = true;
		log.receiveShadow = true;
		group.add(log);
	}

	const lanterns = [lantern(-6.4, 5.1, -0.7), lantern(6.4, -5.1, 2.44)];
	lanterns.forEach(l => group.add(l.group));

	scene.add(group);

	return {
		group,
		update(_dt, time) {
			lanterns.forEach((l, i) => {
				const f = 0.86 + 0.14 * Math.sin(time * 8.1 + i * 2.3) + 0.06 * Math.sin(time * 3.3 + i);
				l.halo.scale.setScalar(1.9 * f);
				l.halo.material.opacity = 0.72 * f;
				l.flame.scale.setScalar(0.88 + 0.16 * f);
			});
		}
	};
}
