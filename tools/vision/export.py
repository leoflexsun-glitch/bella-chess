#!/usr/bin/env python3
# 把训练好的模型折叠 BN、按输出通道做 int8 对称量化，写成 src/vision/weights.js（base64）。
# 二进制布局与 net.js loadNet 对应：每层 int8 权重 [out][in·9 或 in]（4 字节对齐）+ f32 scale[out] + f32 bias[out]。
import argparse
import base64
import datetime
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import ARCH, Net  # noqa: E402
import vlib  # noqa: E402


def fold(model):
    """返回 [(kind, W(out,K) float, b(out))]，conv 已折叠 BN。"""
    mods = list(model.body)
    out = []
    i = 0
    while i < len(mods):
        m = mods[i]
        if isinstance(m, torch.nn.Conv2d):
            bn = mods[i + 1]
            s = (bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach()
            W = (m.weight.detach() * s[:, None, None, None]).reshape(m.out_channels, -1)
            b = (bn.bias - bn.running_mean * s).detach()
            out.append(('conv', W.numpy(), b.numpy()))
            i += 2
        elif isinstance(m, torch.nn.Linear):
            out.append(('dense', m.weight.detach().numpy(), m.bias.detach().numpy()))
        i += 1
    return out


def quantize(W):
    scale = np.maximum(np.abs(W).max(1), 1e-8) / 127.0
    q = np.clip(np.round(W / scale[:, None]), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ckpt')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'vision', 'weights.js'))
    ap.add_argument('--note', default='')
    a = ap.parse_args()
    ck = torch.load(a.ckpt, map_location='cpu')
    model = Net()
    model.load_state_dict(ck['state'])
    model.eval()
    folded = fold(model)
    blob = bytearray()
    layers = []
    fi = 0
    n_dense = sum(1 for x in ARCH if x[0] == 'dense')
    di = 0
    for spec in ARCH:
        if spec[0] == 'pool':
            layers.append({'type': 'pool'})
            continue
        kind, W, b = folded[fi]
        fi += 1
        assert kind == spec[0]
        q, sc = quantize(W)
        blob += q.tobytes()
        while len(blob) % 4:
            blob.append(0)
        blob += sc.tobytes()
        blob += b.astype(np.float32).tobytes()
        if kind == 'dense':
            di += 1
        relu = kind == 'conv' or di < n_dense
        layers.append({'type': kind, 'in': spec[1], 'out': spec[2], 'relu': relu})
    meta = {
        'input': 32,
        'classes': vlib.CLASSES,
        'layers': layers,
        'eps': 8,
        'created': datetime.date.today().isoformat(),
        'note': a.note,
    }
    import json
    b64 = base64.b64encode(bytes(blob)).decode()
    src = ('// 自动生成，请勿手改：tools/vision/export.py 由训练好的模型导出（int8 按通道量化，BN 已折叠）。\n'
           f'export const WEIGHTS = {{\n\tmeta: {json.dumps(meta, ensure_ascii=False)},\n\tdata: \'{b64}\'\n}};\n')
    with open(a.out, 'w') as f:
        f.write(src)
    print(f'wrote {a.out}: {len(blob)} bytes raw, {len(src)} bytes module')


if __name__ == '__main__':
    main()
