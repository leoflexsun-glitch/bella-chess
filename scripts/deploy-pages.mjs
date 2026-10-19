// 发布到 GitHub Pages：构建单文件 index.html，提交到 gh-pages 分支并推送。
// 网站地址：https://leoflexsun-glitch.github.io/bella-chess/
//   npm run deploy
// gh-pages 分支只放发布产物（index.html + .nojekyll），与开发分支互不影响。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

execFileSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
const source = git(['rev-parse', '--short', 'HEAD']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

const dir = mkdtempSync(path.join(tmpdir(), 'gh-pages-'));
try {
	git(['fetch', 'origin', 'gh-pages']);
	git(['worktree', 'add', '-f', dir, 'origin/gh-pages']);
	git(['checkout', '-B', 'gh-pages'], dir);
	copyFileSync(path.join(root, 'index.html'), path.join(dir, 'index.html'));
	writeFileSync(path.join(dir, '.nojekyll'), '');
	git(['add', 'index.html', '.nojekyll'], dir);
	if (!git(['status', '--porcelain'], dir)) {
		console.log('gh-pages 已是最新，无需发布');
	} else {
		git(['commit', '-m', `发布：由 ${branch}@${source} 构建`], dir);
		git(['push', 'origin', 'gh-pages'], dir);
		console.log('已推送 gh-pages，约 1 分钟后生效：https://leoflexsun-glitch.github.io/bella-chess/');
	}
} finally {
	git(['worktree', 'remove', '--force', dir]);
	rmSync(dir, { recursive: true, force: true });
}
