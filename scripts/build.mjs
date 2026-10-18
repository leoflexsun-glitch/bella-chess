// 把 src/ 打成一个自包含的 index.html：脚本、worker、样式、字体全部内联。
// 发布环境只放行单个文件也能完整运行；开发时直接开 src/index.html（ES 模块 + importmap）。
//
//   node scripts/build.mjs          生成 index.html
//   node scripts/build.mjs --check  只比对，不一致时退出码 1（测试用，防止源码和产物脱节）

import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => path.join(root, ...parts);

// 与 src/index.html 里的 importmap 一致：three 和 three/addons 指向 vendor/。
const vendor = {
	name: 'vendor',
	setup(b) {
		b.onResolve({ filter: /^three(\/addons\/.*)?$/ }, args => ({
			path: args.path === 'three'
				? at('vendor/three.module.min.js')
				: at('vendor', args.path.slice('three/'.length))
		}));
	}
};

// match.js 的 import.meta 分支只服务开发模式，打包后走内联 worker，警告无意义。
const common = { bundle: true, minify: true, write: false, logLevel: 'warning', charset: 'utf8', logOverride: { 'empty-import-meta': 'silent' } };

async function bundleJs(entry, extra = {}) {
	const out = await build({ ...common, entryPoints: [at(entry)], format: 'iife', plugins: [vendor], ...extra });
	return out.outputFiles[0].text;
}

async function bundleCss(entry) {
	const out = await build({ ...common, entryPoints: [at(entry)], loader: { '.woff2': 'dataurl', '.svg': 'dataurl' } });
	return out.outputFiles[0].text;
}

// 内联进 <script> 后，任何 "</script" 都会提前截断标签。
const scriptSafe = js => js.replace(/<\/script/gi, '<\\/script');

export async function render() {
	const [template, worker, main, css] = await Promise.all([
		readFile(at('src/index.html'), 'utf8'),
		bundleJs('src/chess/worker.js'),
		bundleJs('src/main.js', { define: { __INLINE_WORKER__: 'window.__INLINE_WORKER__' } }),
		bundleCss('src/ui/ui.css')
	]);

	const styleTag = '<link rel="stylesheet" href="./ui/ui.css">';
	const scriptBlock = /<!-- build:script[^>]*-->[\s\S]*?<!-- \/build:script -->/;
	if (!template.includes(styleTag) || !scriptBlock.test(template)) {
		throw new Error('src/index.html 缺少样式链接或 build:script 标记');
	}

	const inline = `<script>window.__INLINE_WORKER__=${scriptSafe(JSON.stringify(worker))};\n${scriptSafe(main)}</script>`;
	return template
		.replace(styleTag, () => `<style>\n${css}</style>`)
		.replace(scriptBlock, () => inline);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const html = await render();
	const target = at('index.html');
	if (process.argv.includes('--check')) {
		const current = await readFile(target, 'utf8').catch(() => '');
		if (current !== html) {
			console.error('index.html 与 src/ 不一致：请运行 npm run build');
			process.exit(1);
		}
		console.log('index.html 与 src/ 一致');
	} else {
		await writeFile(target, html);
		console.log(`index.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
	}
}
