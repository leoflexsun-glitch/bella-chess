# 棋图识别（离线）——数据生成、训练与评测

`src/vision/` 是运行时模块（零依赖、纯 JS，浏览器与 Node ≥ 22 通用），本目录是复现它所需的全部脚本。
范围：**平面 2D 数字棋图**（Lichess / Chess.com 风格棋盘、书籍棋图）的截图或屏幕翻拍。实体 3D 棋盘不在范围内。

## 运行时 API（`src/vision/index.js`）

```js
locateBoard(img)            // → { corners: [TL,TR,BR,BL], score } | null
readBoard(img, corners)     // → { squares: string[64], confidence: Float32Array(64) }（显示顺序，左上起逐行）
guessFlipped(squares)       // → true 表示黑方在下
toPlacement(squares, flipped) // → FEN 摆放字段
recognize(img)              // → { corners, squares, confidence, flipped, placement, score } | null
```

`img` 为 ImageData 兼容对象 `{ width, height, data: Uint8ClampedArray(RGBA) }`。`recognize` 额外带回定位得分 `score`（0..1），界面可据此决定是否提示手动校正四角。

### 内部结构

| 文件 | 作用 |
| --- | --- |
| `locate.js` | 棋盘定位：图像金字塔 + 积分图上的 X 角点响应（四象限"对角同色"减去对角内部不平衡），异号点对位移投票求格点基向量，连成格点阵，取 7×7 窗口，由粗到细逐层吸附到原图并做亚像素抛物线插值，最后稳健拟合仿射（必要时透视） |
| `warp.js` | 灰度化、单位正方形→四边形单应、带超采样的重采样（等效面积平均）、整盘归一化、切 64 格 |
| `net.js` | 手写 CNN 推理（im2col + 4×4 寄存器分块 GEMM，首层直接卷积），权重 int8 按通道量化 |
| `chess.js` | 棋规先验（每方至多 1 王、至多 8 兵、兵不在首末行）、方向判断、FEN 摆放串 |
| `weights.js` | 由 `export.py` 生成的 base64 权重 |

分类网络：输入 32×32 灰度格（整盘零均值单位方差归一化），
`conv16-pool-conv24-pool-conv48-pool-conv64-fc96-fc13`，约 2.2 M 乘加/格、约 14 万参数。

## 复现步骤

需要：Python 3.11+、Node ≥ 22、预装的 Playwright Chromium（`/opt/node-tools/node_modules/playwright`，浏览器在 `/opt/pw-browsers`）。
所有生成物都在 `tools/vision/.cache/`（已 gitignore）。

```sh
cd tools/vision
python3 -m venv --system-site-packages .cache/venv
.cache/venv/bin/pip install torch chess numpy pillow   # torch 走 PyPI（CPU 即可）
python3 -I fetch_assets.py                              # 下载 12 套棋子 SVG
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node render_sprites.cjs   # 光栅化为 256px PNG
.cache/venv/bin/python check_parity.py                  # 训练端/运行端重采样逐像素一致性检查
./make_data.sh                                          # 生成训练/评测格子集（4 核约 15 分钟）

# 1) 泛化实验：留出 merida + pirouetti 训练模型 A 并评测
.cache/venv/bin/python train.py --data .cache/data/trainA.npz .cache/data/app_clean_tr.npz .cache/data/app_decor_tr.npz --out .cache/models/A.pt --epochs 4
.cache/venv/bin/python export.py .cache/models/A.pt --out .cache/weights_A.js
.cache/venv/bin/python dump_eval.py .cache/data/ev_*.npz
node eval_tiles.mjs --weights .cache/weights_A.js .cache/data/ev_holdout_full .cache/data/ev_holdout_clean .cache/data/ev_indist_full .cache/data/ev_app_clean .cache/data/ev_app_decor

# 2) 发布模型：全部套装重新训练，导出到 src/vision/weights.js
.cache/venv/bin/python train.py --data .cache/data/trainA.npz .cache/data/app_clean_tr.npz .cache/data/app_decor_tr.npz .cache/data/holdout_tr.npz --out .cache/models/final.pt --epochs 4
.cache/venv/bin/python export.py .cache/models/final.pt

# 3) 截图级评测（定位 + 端到端）
.cache/venv/bin/python gen_screens.py --out .cache/screens/screen --n 400 --sets all --seed 11
.cache/venv/bin/python gen_screens.py --out .cache/screens/photo  --n 100 --kind photo --sets all --seed 12
node eval_screens.mjs .cache/screens/screen
node eval_screens.mjs .cache/screens/photo

# 测试夹具（tests/vision/fixtures，可复现）
.cache/venv/bin/python make_fixtures.py
```

### 合成数据要点

- 渲染：整盘渲染后再按运行时完全相同的方式（`vlib.sample_tiles` ≡ `warp.js`）采样，模型看到的输入分布与线上一致。
- 局面：70% 均衡随机局面（每格独立抽样）+ 30% 随机对局（python-chess，偏好吃子）；50% 黑方在下。
- 配色：25% app 的三套主题，40% 常见网站/书籍主题，其余随机（含低对比度）；纹理：木纹、大理石、细噪声、书籍斜线阴影。
- 装饰：上一步/选中高亮、将军红光、着法提示点/吃子圈、格内坐标、箭头、棋子投影、外框与框外坐标。
- 退化：格宽 20–120px、浏览器缩放到非整数格宽、模糊、噪声、JPEG、亮度/对比度/gamma/白平衡、摩尔纹、眩光；
  四角独立抖动（2%/7%/14% 格宽三档 + 整体平移）模拟定位误差与轻微透视，再加每格 ±6% 平移/缩放。
- 在线增强：水平翻转（棋子镜像不改类别）、±1px 平移、对比度/偏置扰动、噪声。

## 评测结果

METRICS_PLACEHOLDER

## 训练用棋子套装与许可

只使用许可明确允许再分发/派生的套装（来源：lichess-org/lila `COPYING.md`）。
排除了 CC BY-NC*、"freeware"/仅限个人使用的套装（alpha、chess7、companion、leipzig、california、maestro 等），
以及抽象套装（mono、shapes、letter、kiwen-suwi）。

| 套装 | 作者 | 许可 |
| --- | --- | --- |
| cburnett | Colin M.L. Burnett | GPLv2+ |
| merida | Armando Hernandez Marroquin | GPLv2+ |
| chessnut | Alexis Luengas | Apache 2.0 |
| celtic | Maurizio Monge | MIT |
| fantasy | Maurizio Monge | MIT |
| spatial | Maurizio Monge | MIT |
| papercut | Nikolay Anzarov | CC BY 4.0 |
| rhosgfx | RhosGFX | CC0 1.0 |
| totoy | Kosal Sen | CC BY 4.0 |
| mpchess | Maxime Chupin | GPLv3+ |
| pirouetti | pirouetti | AGPLv3+ |
| pixel | therealqtpi | AGPLv3+ |

另用系统字体渲染 Unicode 棋子字形（U+2654–265F）模拟书籍棋图，三种样式（空心 / 填白 / 实心描边）：
DejaVu Sans / Sans Bold / Sans Mono（Bitstream Vera 许可）、FreeSerif / FreeSerif Bold / FreeMono（GPLv3+ with font exception）、
GNU Unifont（GPLv2+ with font exception / OFL）。

模型权重只是从这些图像学到的统计量，不包含任何素材本身；素材只在本地 `.cache/` 中使用，不入库。
