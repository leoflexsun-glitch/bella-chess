# 霜林弃兵 · 国际象棋

和电脑下国际象棋：清爽的 2D 棋盘（三套主题 × 三套棋子）、可选的 3D 雪林场景，
还能拍一张棋图、在本机离线识别后从该局面开新局。

**在线试玩：<https://leoflexsun-glitch.github.io/bella-chess/>**

| 功能 | 说明 |
|---|---|
| 对弈 | 点击或拖拽走子，四档电脑对手，悔棋、翻转、复盘、刷新自动恢复 |
| 提示 | 电脑替你算一步，在棋盘上画箭头 |
| 摆棋 | 自由摆放棋子，校验合法性后从该局面开新局 |
| 拍照复刻 | 截图/翻拍/书上棋图 → 离线识别 → 核对 → 开新局（图片不上传） |
| 3D 雪林 | 设置里切换；只在切换时才加载 |

## 开发

```bash
npm install
npm run dev        # 打开 http://localhost:5173/src/index.html（开发入口，改了即生效）
npm run build      # 生成根目录 index.html（发布用的自包含单文件）
npm test           # 走法 perft、局面校验、对局流程、识别模块、产物同步检查
npm run e2e        # 浏览器端到端（需 Playwright：npx playwright install chromium）
```

发布只需要根目录的 `index.html` 一个文件；GitHub Pages 直接发布仓库根目录即可。
架构说明见 [`info.md`](info.md)，识别模型的训练与评测见 [`tools/vision/README.md`](tools/vision/README.md)。

## 第三方素材

- 棋子：celtic / fantasy（Maurizio Monge，MIT）、chessnut（Alexis Luengas，Apache-2.0），见 [`assets/pieces/`](assets/pieces/)
- 3D：three.js（MIT）；字体：Geist（OFL）
