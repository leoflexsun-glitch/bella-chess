// 发布产物 index.html 必须由当前 src/ 构建而来，防止改了源码忘记重新打包。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { render } from '../scripts/build.mjs';

test('index.html 与 src/ 同步', async () => {
	const [built, committed] = await Promise.all([render(), readFile(new URL('../index.html', import.meta.url), 'utf8')]);
	assert.ok(built === committed, 'index.html 过期：请运行 npm run build');
});
