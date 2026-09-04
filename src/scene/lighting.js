import * as THREE from 'three';

// 冬日傍晚的光：一轮低垂的冷太阳穿过树干，棋盘旁一对暖灯笼，
// 再加上雪地反射的大片天光。
export function createLighting(scene, cfg) {
	const sunDir = new THREE.Vector3(-0.46, 0.13, -0.84).normalize();

	const sun = new THREE.DirectionalLight(0xffd6a4, 1.75);
	sun.position.copy(sunDir).multiplyScalar(46);
	sun.castShadow = cfg.shadow > 0;
	if (cfg.shadow > 0) {
		sun.shadow.mapSize.set(cfg.shadow, cfg.shadow);
		sun.shadow.camera.near = 8;
		sun.shadow.camera.far = 96;
		sun.shadow.camera.left = -16;
		sun.shadow.camera.right = 16;
		sun.shadow.camera.top = 16;
		sun.shadow.camera.bottom = -16;
		sun.shadow.bias = -0.0006;
		sun.shadow.normalBias = 0.028;
		sun.shadow.radius = 2.4;
	}
	scene.add(sun);
	scene.add(sun.target);

	const sky = new THREE.HemisphereLight(0x5f81b6, 0x141c2e, 0.62);
	scene.add(sky);

	const fill = new THREE.DirectionalLight(0x9dbde8, 0.42);
	fill.position.set(9.0, 6.5, 7.0);
	scene.add(fill);

	// 一束柔和的月光直照棋盘，让棋子始终清楚可辨。
	const table = new THREE.SpotLight(0xd8e6ff, 24, 22, 0.70, 0.92, 1.3);
	table.position.set(1.4, 9.8, 2.6);
	table.target.position.set(0, 0, 0);
	scene.add(table, table.target);

	const lanterns = [];
	for (const [x, z] of [[-6.4, 5.1], [6.4, -5.1]]) {
		const light = new THREE.PointLight(0xffb060, 15.0, 26, 1.85);
		light.position.set(x, 2.55, z);
		scene.add(light);
		lanterns.push({ light, base: 15.0, seed: Math.random() * 10 });
	}

	return {
		sun, sky, fill, table, sunDir,
		lanterns: lanterns.map(l => l.light),
		update(_dt, time) {
			for (const l of lanterns) {
				const flicker = 0.82 + 0.18 * (Math.sin(time * 7.3 + l.seed) * 0.5 + Math.sin(time * 2.7 + l.seed * 3) * 0.5);
				l.light.intensity = l.base * flicker;
			}
		},
		setQuality(next) {
			sun.castShadow = next.shadow > 0;
			if (next.shadow > 0) sun.shadow.mapSize.set(next.shadow, next.shadow);
		}
	};
}
