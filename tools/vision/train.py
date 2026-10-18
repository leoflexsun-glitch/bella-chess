#!/usr/bin/env python3
# 训练格子分类器（13 类）。结构必须与 src/vision/net.js 支持的层一致：conv3×3(same)+BN+ReLU / maxpool2 / dense。
# 用法：train.py --data a.npz b.npz --out .cache/models/A.pt --epochs 6
import argparse
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ARCH = [  # 与导出的 meta.layers 一一对应
    ('conv', 1, 16), ('pool',),
    ('conv', 16, 24), ('pool',),
    ('conv', 24, 48), ('pool',),
    ('conv', 48, 64),
    ('dense', 64 * 4 * 4, 96),
    ('dense', 96, 13),
]
EPS = 8.0  # 与 warp.js normalizeBoard 的 eps 一致


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        layers = []
        n_dense = sum(1 for a in ARCH if a[0] == 'dense')
        d = 0
        for a in ARCH:
            if a[0] == 'conv':
                layers += [nn.Conv2d(a[1], a[2], 3, padding=1, bias=False), nn.BatchNorm2d(a[2]), nn.ReLU(inplace=True)]
            elif a[0] == 'pool':
                layers.append(nn.MaxPool2d(2))
            else:
                if d == 0:
                    layers.append(nn.Flatten())
                d += 1
                layers.append(nn.Linear(a[1], a[2]))
                if d < n_dense:
                    layers += [nn.ReLU(inplace=True), nn.Dropout(0.25)]
        self.body = nn.Sequential(*layers)

    def forward(self, x):
        return self.body(x)


def load(paths):
    T, L, S = [], [], []
    for p in paths:
        z = np.load(p)
        T.append(z['tiles'])
        L.append(z['labels'])
        S.append(z['stats'])
    return np.concatenate(T), np.concatenate(L).astype(np.int64), np.concatenate(S)


def normalize(tiles_u8, stats):
    x = tiles_u8.float()
    return (x - stats[:, 0, None, None]) / (stats[:, 1, None, None] + EPS)


def augment(x, g):
    # 训练时的在线增强：水平翻转（棋子左右镜像仍是同一类）、±1px 平移、轻微对比度/偏置/噪声
    B = x.shape[0]
    flip = torch.rand(B, generator=g) < 0.5
    x = torch.where(flip[:, None, None], x.flip(-1), x)
    if True:
        sh = torch.randint(-1, 2, (2,), generator=g)
        x = torch.roll(x, shifts=(int(sh[0]), int(sh[1])), dims=(1, 2))
    a = 1 + (torch.rand(B, 1, 1, generator=g) - 0.5) * 0.3
    b = (torch.rand(B, 1, 1, generator=g) - 0.5) * 0.3
    x = x * a + b
    x = x + torch.randn(x.shape, generator=g) * 0.03
    return x


@torch.no_grad()
def predict(model, tiles, stats, bs=2048):
    model.eval()
    out = []
    for i in range(0, len(tiles), bs):
        x = normalize(torch.from_numpy(tiles[i:i + bs]), torch.from_numpy(stats[i:i + bs]))
        out.append(F.softmax(model(x[:, None]), 1))
    return torch.cat(out).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', nargs='+', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--epochs', type=float, default=6)
    ap.add_argument('--bs', type=int, default=256)
    ap.add_argument('--lr', type=float, default=3e-3)
    ap.add_argument('--threads', type=int, default=4)
    ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    torch.manual_seed(a.seed)
    tiles, labels, stats = load(a.data)
    n = len(tiles)
    # 最后 1% 的整盘作为快速验证（按 64 格对齐）
    nval = (n // 64 // 100) * 64
    perm_boards = np.random.default_rng(a.seed).permutation(n // 64)
    val_b = perm_boards[:nval // 64]
    vmask = np.zeros(n, bool)
    for b in val_b:
        vmask[b * 64:(b + 1) * 64] = True
    tr_idx = np.nonzero(~vmask)[0]
    va_idx = np.nonzero(vmask)[0]
    print(f'train {len(tr_idx)} tiles, val {len(va_idx)}', 'class counts', np.bincount(labels, minlength=13).tolist())
    Tt = torch.from_numpy(tiles)
    Lt = torch.from_numpy(labels)
    St = torch.from_numpy(stats)
    model = Net().to(memory_format=torch.channels_last)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=2e-4)
    steps_per_epoch = len(tr_idx) // a.bs
    total = int(steps_per_epoch * a.epochs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=total, pct_start=0.15)
    g = torch.Generator().manual_seed(a.seed)
    step, t0 = 0, time.time()
    rng = np.random.default_rng(a.seed + 1)
    while step < total:
        perm = rng.permutation(tr_idx)
        model.train()
        run_loss, run_acc, cnt = 0.0, 0.0, 0
        for i in range(0, len(perm) - a.bs + 1, a.bs):
            if step >= total:
                break
            idx = torch.from_numpy(perm[i:i + a.bs])
            x = augment(normalize(Tt[idx], St[idx]), g)[:, None].contiguous(memory_format=torch.channels_last)
            y = Lt[idx]
            logits = model(x)
            loss = F.cross_entropy(logits, y, label_smoothing=0.05)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            step += 1
            run_loss += loss.item()
            run_acc += (logits.argmax(1) == y).float().mean().item()
            cnt += 1
            if step % 500 == 0:
                print(f'step {step}/{total} loss {run_loss / cnt:.4f} acc {run_acc / cnt:.4f} '
                      f'lr {sched.get_last_lr()[0]:.2e} {time.time() - t0:.0f}s', flush=True)
                run_loss, run_acc, cnt = 0.0, 0.0, 0
        p = predict(model, tiles[va_idx], stats[va_idx])
        acc = (p.argmax(1) == labels[va_idx]).mean()
        print(f'== epoch done at step {step}: val per-square acc {acc:.5f} ({time.time() - t0:.0f}s)', flush=True)
        # 每个 epoch 都落盘，长时间训练被打断也不至于全丢
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        torch.save({'state': model.state_dict(), 'arch': ARCH, 'step': step, 'total': total}, a.out)
    print('saved', a.out)


if __name__ == '__main__':
    main()
