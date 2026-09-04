import * as THREE from 'three';
import { NOISE } from '../scene/glsl.js';

const RECIPES = {
	ivory: {
		base: { color: 0xe6d8bd, roughness: 0.40, metalness: 0.0, clearcoat: 0.34, clearcoatRoughness: 0.38, sheen: 0.5, sheenColor: new THREE.Color(0xffe6c2), envMapIntensity: 0.55 },
		glsl: {
			grain: `
				// 骨纹：沿车削轴分布的长条纹，再加细密的孔隙。
				float band = fbm3(vObject * vec3(3.2, 26.0, 3.2));
				float pore = fbm3(vObject * 54.0);
				diffuseColor.rgb *= 0.90 + 0.16 * band + 0.05 * pore;
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.68, 0.52), smoothstep(0.55, 0.9, band) * 0.28);`,
			rough: `roughnessFactor *= 0.86 + 0.30 * fbm3(vObject * 30.0);`,
			light: `
				// 廉价的透光感：光从轮廓边缘渗进来。
				float rim = pow(1.0 - abs(dot(normalize(vWorldNormal), normalize(cameraPosition - vWorld))), 2.6);
				outgoingLight += rim * vec3(0.42, 0.30, 0.19) * 0.55;`,
			accent: 'vec3(0.98, 0.80, 0.48)'
		}
	},
	obsidian: {
		base: { color: 0x0d1017, roughness: 0.17, metalness: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.10, iridescence: 0.38, iridescenceIOR: 1.7, envMapIntensity: 0.9 },
		glsl: {
			grain: `
				// 贝壳状断口：大块的壳片，内部泛着冷光。
				float shell = fbm3(vObject * vec3(5.0, 7.0, 5.0));
				float shard = ridged(vObject.xz * 22.0 + vObject.y * 9.0);
				diffuseColor.rgb += vec3(0.030, 0.042, 0.070) * smoothstep(0.45, 0.85, shell);
				diffuseColor.rgb += vec3(0.018, 0.024, 0.048) * pow(shard, 3.0);`,
			rough: `roughnessFactor = clamp(roughnessFactor * (0.7 + 0.8 * fbm3(vObject * 16.0)), 0.05, 0.6);`,
			light: `
				float rim = pow(1.0 - abs(dot(normalize(vWorldNormal), normalize(cameraPosition - vWorld))), 3.0);
				outgoingLight += rim * vec3(0.26, 0.34, 0.62) * 0.7;`,
			accent: 'vec3(0.62, 0.78, 1.0)'
		}
	}
};

// 每个棋子各有一份材质，这样才能单独发光；但它们共享一份编译好的
// 着色器程序，因为按配方注入的代码完全相同。
export function pieceMaterial(kind) {
	const recipe = RECIPES[kind];
	const uniforms = {
		uLift: { value: 0 },
		uDust: { value: kind === 'ivory' ? 0.16 : 0.24 },
		uAccent: { value: new THREE.Color(kind === 'ivory' ? 0xfff3e0 : 0xdcecff) }
	};

	const material = new THREE.MeshPhysicalMaterial(recipe.base);
	material.userData.uniforms = uniforms;

	material.onBeforeCompile = shader => {
		Object.assign(shader.uniforms, uniforms);

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>
				varying vec3 vObject;
				varying vec3 vWorld;
				varying vec3 vWorldNormal;`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>
				vObject = position;
				vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
				vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`);

		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
				uniform float uLift;
				uniform float uDust;
				uniform vec3 uAccent;
				varying vec3 vObject;
				varying vec3 vWorld;
				varying vec3 vWorldNormal;
				${NOISE}`)
			.replace('#include <color_fragment>', `#include <color_fragment>
				${recipe.glsl.grain}
				// 雪落在每个棋子的肩上。
				float lie = smoothstep(0.42, 0.92, vWorldNormal.y);
				float patchy = smoothstep(0.36, 0.70, fbm3(vObject * 17.0));
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), lie * patchy * uDust);`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
				${recipe.glsl.rough}`)
			.replace('#include <opaque_fragment>', `
				{
					${recipe.glsl.light}
					float edge = pow(1.0 - abs(dot(normalize(vWorldNormal), normalize(cameraPosition - vWorld))), 1.8);
					outgoingLight += uLift * (edge * 1.5 + 0.16) * uAccent;
				}
				#include <opaque_fragment>`);
	};

	return material;
}
