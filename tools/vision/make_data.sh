#!/bin/sh
# 生成全部训练/评测数据（约 15–20 分钟，4 核）。产物都在 .cache/data/。
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
PY="$HERE/.cache/venv/bin/python"
G="$PY $HERE/gen_tiles.py"
D="$HERE/.cache/data"
mkdir -p "$D"

# 训练集 A：不含留出的 merida/pirouetti
$G --out "$D/trainA.npz"        --boards 12000 --sets train   --positions mix       --aug full  --seed 1
$G --out "$D/app_clean_tr.npz"  --boards 900   --sets app     --positions mix       --aug clean --app-themes --seed 2
$G --out "$D/app_decor_tr.npz"  --boards 900   --sets app     --positions mix       --aug decor --seed 3
# 最终模型额外加入留出套装
$G --out "$D/holdout_tr.npz"    --boards 1500  --sets holdout --positions mix       --aug full  --seed 4

# 评测集（全部用真实对局局面；不做棋子造型增强，保持真实套装原样）
SHAPE_AUG=0 $G --out "$D/ev_holdout_full.npz"  --boards 300 --sets holdout --positions realistic --aug full  --seed 101
SHAPE_AUG=0 $G --out "$D/ev_holdout_clean.npz" --boards 300 --sets holdout --positions realistic --aug clean --seed 102
SHAPE_AUG=0 $G --out "$D/ev_indist_full.npz"   --boards 300 --sets train   --positions realistic --aug full  --seed 103
SHAPE_AUG=0 $G --out "$D/ev_app_clean.npz"     --boards 450 --sets app     --positions realistic --aug clean --app-themes --seed 104
SHAPE_AUG=0 $G --out "$D/ev_app_decor.npz"     --boards 300 --sets app     --positions realistic --aug decor --seed 105
