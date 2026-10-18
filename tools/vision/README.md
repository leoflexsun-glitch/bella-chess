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

# 1) 泛化实验：留出 merida + pirouetti 训练模型 A2 并评测（4 核约 20 分钟/3 epoch）
.cache/venv/bin/python train.py --data .cache/data/trainA.npz .cache/data/app_clean_tr.npz .cache/data/app_decor_tr.npz --out .cache/models/A2.pt --epochs 3
.cache/venv/bin/python export.py .cache/models/A2.pt --out .cache/weights_A2.js
.cache/venv/bin/python dump_eval.py .cache/data/ev_*.npz
node eval_tiles.mjs --weights .cache/weights_A2.js .cache/data/ev_holdout_full .cache/data/ev_holdout_clean .cache/data/ev_indist_full .cache/data/ev_app_clean

# 2) 发布模型：全部套装重新训练，导出到 src/vision/weights.js
.cache/venv/bin/python train.py --data .cache/data/trainA.npz .cache/data/app_clean_tr.npz .cache/data/app_decor_tr.npz .cache/data/holdout_tr.npz --out .cache/models/final.pt --epochs 3 --seed 1
.cache/venv/bin/python export.py .cache/models/final.pt
node eval_tiles.mjs .cache/data/ev_app_clean .cache/data/ev_app_decor .cache/data/ev_indist_full .cache/data/ev_holdout_full .cache/data/ev_holdout_clean

# 3) 截图级评测（定位 + 端到端），用调参时没见过的新种子
.cache/venv/bin/python gen_screens.py --out .cache/screens/test_screen         --n 500 --sets all     --seed 21
.cache/venv/bin/python gen_screens.py --out .cache/screens/test_photo          --n 150 --sets all     --seed 22 --kind photo
.cache/venv/bin/python gen_screens.py --out .cache/screens/test_screen_holdout --n 200 --sets holdout --seed 23
.cache/venv/bin/python gen_screens.py --out .cache/screens/test_screen_app     --n 200 --sets app     --seed 24
node eval_screens.mjs .cache/screens/test_screen        # 另有 --locate-only / --verbose
node eval_screens.mjs .cache/screens/test_photo
node eval_screens.mjs .cache/screens/test_screen_app
node eval_screens.mjs .cache/screens/test_screen_holdout --weights .cache/weights_A2.js
.cache/venv/bin/python eval_flip.py 3000                # 方向判断
node bench.mjs                                          # 计时

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
- 棋子造型增强（训练集一半的盘，整盘统一，模拟没见过的套装；`SHAPE_AUG` 环境变量控制，评测集固定为 0）：
  棋子缩放 0.62–1.05、长宽比、整体偏上/偏下、3×3 膨胀/腐蚀改变笔画粗细、白子/黑子各自的亮度区间重映射与轻微色偏（改变"有多白、描边多深"）。
- 在线增强：水平翻转（棋子镜像不改类别）、±1px 平移、对比度/偏置扰动、噪声。
- 运行时把近乎纯色（内圈灰度标准差 < 1.2，且未过曝/死黑）的格子直接判空、不进网络；评测里这条规则从未误跳过有子的格子。

## 评测结果

所有数字都用**运行端的 JS 代码**（int8 权重 + 棋规先验 + 空格跳过，与 `readBoard` 完全同一路径）测得；
评测集与训练集种子不同，定位/端到端的截图集是在调完定位器之后用新种子重新生成的（`test_*`），没有参与任何调参。
"逐格"= 64 格逐个比较；"整盘"= 64 格全对。

### 1. 泛化估计（留出整套棋子）

模型 A2：训练时完全不含 merida、pirouetti（与发布模型同一配方，只少这两套）。局面为随机对局。

| 评测集 | 逐格 | 整盘 | merida 逐格 / 整盘 | pirouetti 逐格 / 整盘 |
| --- | --- | --- | --- | --- |
| 干净渲染（精确四角、无退化） | 97.62% | 48.3% | 99.88% / 145/153 | 95.27% / 0/147 |
| 真实感退化（四角抖动、模糊/噪声/JPEG/摩尔纹/眩光、高亮、坐标…） | 96.72% | 39.7% | 99.58% / 119/142 | 94.15% / 0/158 |
| 合成截图端到端（200 张，自己定位） | 97.16% | 39.5% | — | — |

- merida（传统 Staunton 造型，与训练套装风格接近）泛化很好：逐格 99.6–99.9%，整盘 84–95%。
- pirouetti 是困难样本：白子没有深色描边（白子压在浅格上几乎只剩阴影），王的轮廓在 32px 下像车，
  主要错误是 K→R / k→r / Q→R。**这说明对于造型差异很大、没见过的套装，整盘一次全对的概率不高**，界面需要允许逐格修改。
- 对照：不加"棋子造型增强"的模型 A 在同样两套上为 96.0%（退化）/ 97.1%（干净），pirouetti 92.7% / 94.1%；
  造型增强把 pirouetti 提高约 1.5 个百分点，merida 基本持平，因此发布模型采用了该增强。

### 2. 分布内 & app 显示套装（发布模型，全部 12 套 + Unicode 字形训练）

| 评测集 | 局面数 | 逐格 | 整盘 |
| --- | --- | --- | --- |
| **app 套装 celtic/chessnut/fantasy × 3 主题，干净渲染**（格宽 20–120px） | 450 | **100.000%** | **100.0%** |
| app 套装 + 坐标/高亮/将军/提示点等装饰 | 300 | 99.995%（1 格） | 99.7% |
| 训练套装，真实感退化 | 300 | 99.84% | 93.3% |
| 　其中 Unicode 字形（书籍棋图，19 种字体/样式） | 65 | 99.83% | 59/65 |
| merida + pirouetti（已加入训练），真实感退化 | 300 | 99.45% | 83.3% |
| merida + pirouetti（已加入训练），干净渲染 | 300 | 100.000% | 100.0% |

棋规先验（每方 ≤1 王、≤8 兵、兵不在首末行）在退化集上把整盘正确率提高约 1 个百分点。

### 3. 棋盘定位（发布版 `locateBoard`）

成功 = 四角最大误差 ≤ 2% 板宽。截图含页面 UI（导航栏、着法列表、按钮、评估条、玩家条）、外框/框外坐标、
格内坐标、高亮、将军红光、箭头、10% 带小缩略棋盘干扰、15% 裁成只剩棋盘、20% JPEG；板宽 160–1600px。

| 测试集 | 张数 | 成功率 | 误差中位数 | 平均耗时 |
| --- | --- | --- | --- | --- |
| 合成截图（全部套装） | 500 | **100.0%** | 0.03% | 124 ms |
| 合成截图（app 套装） | 200 | 100.0% | 0.03% | — |
| 合成截图（留出套装） | 200 | 99.0%（1 张返回 null） | 0.03% | — |
| 屏幕翻拍（透视 ±6%、旋转 ±8°、摩尔纹、眩光、暗角、模糊、噪声、JPEG） | 150 | 96.7%（2 张 null，3 张错位） | 0.07% | 478 ms |

调参阶段用过的另一批（400 截图 / 100 翻拍 / 150 留出套装截图）最终也都是 100%。

### 4. 端到端 `recognize()`

| 测试集 | 64 格全对（显示顺序） | FEN 摆放完全正确（含方向） | 方向判断 |
| --- | --- | --- | --- |
| 合成截图（全部套装，500） | 97.8% | 93.4% | 95.6% |
| 合成截图（app 套装，200） | 98.0% | 92.5% | 94.5% |
| 屏幕翻拍（150） | 92.0% | 85.3% | 93.3% |
| 合成截图（留出套装，模型 A2，200） | 39.5% | 37.0% | 91.5% |

端到端的主要损失来自**方向判断**：测试局面来自随机走子（0–140 步），长对局里王和兵随机游走，
仅凭子力分布判断哪方在下本身就有歧义。单独评测（`eval_flip.py`）：开局/中局 100%，
残局 92.5%，总体 95.3%；只取 20/60/120 步的对局时为 99.5%。真实对局的结构（易位、兵链）更规整，实际会更好。
也试过用逻辑回归拟合 12×64 的"子-格"权重，留出准确率 94.4%，不如手写规则，未采用。

### 5. 体积与速度（Node 22，本机 Xeon 2.8 GHz 单线程，`bench.mjs`）

- 权重模块 `weights.js`：**187 KB**（14.3 万参数，int8 按通道量化），首次调用时解码约 14 ms。
- `readBoard`：典型截图 110–140 ms（纯色空格跳过网络）；最坏情况（64 格全部走 CNN）约 220 ms；其中重采样约 10 ms。
- `locateBoard`：截图中位数 50–90 ms（640×420–2560×1440），最慢约 0.5 s；翻拍（约 2000×2000）平均约 0.5 s。

## 已知局限

- **没见过且造型特殊的棋子套装**（如 pirouetti 这类无描边、细长造型）逐格约 94–95%，整盘很少全对；常见 Staunton 风格（如 merida）基本没问题。
- **方向判断**是启发式，残局局面约 92–95%；未利用棋盘边上的坐标字母。界面应提供"翻转"按钮。
- **翻拍照片**：约 3% 返回 null 或错位（错位时多为整体偏一格）；强透视（>10°）、严重反光、手指遮挡未测试。
- 只处理**轴向基本对齐**的数字棋盘（旋转超过约 15° 时向量投票锥会失效）；实体 3D 棋盘不在范围内。
- 定位依赖亮暗格交替：亮暗格**亮度几乎相同**（只差色相）的配色会失败（灰度差小于约 4 级）。
- 被眩光洗成全白的白子（压在亮格上）无法恢复。
- 合成评测不能完全代表真实世界截图（字体渲染、子像素抗锯齿、各站点的特殊皮肤），数字应视为上限估计。

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
