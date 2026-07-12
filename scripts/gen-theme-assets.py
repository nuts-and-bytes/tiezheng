#!/usr/bin/env python3
"""一次性资产生成器（幂等）。

1) Anton-Regular.ttf --(pyftsubset U+0020-007E)--> woff2 --> base64
2) 64x64 灰度噪点 PNG（zlib 手写编码，无需 PIL）--> base64
3) 就地重写 src/styles/theme.css 中带 /* GEN:ANTON */ 和 /* GEN:GRAIN */ 标记的下一行

前置：python3 需装 fontTools 和 brotli（本机 /usr/local/bin/python3 已具备）。
构建（vite / Cloudflare）不依赖本脚本——生成结果已 commit 进 theme.css。
"""
import base64
import io
import pathlib
import random
import struct
import zlib

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
TTF = ROOT / 'assets' / 'fonts' / 'Anton-Regular.ttf'
CSS = ROOT / 'src' / 'styles' / 'theme.css'


def anton_b64() -> str:
    # recalcTimestamp=False 是幂等的前提：fontTools 默认会把 head.modified 刷成当前时间，
    # 字节一变 brotli 输出就变（实测 4772↔4776 来回跳），每跑一次 theme.css 就产生一次无谓 diff。
    font = TTFont(str(TTF), recalcTimestamp=False)
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = []
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = []
    opts.notdef_outline = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=list(range(0x20, 0x7F)))  # 数字 + 基本拉丁；中文用回退字体
    sub.subset(font)
    font.flavor = 'woff2'
    buf = io.BytesIO()
    font.save(buf)
    data = buf.getvalue()
    print(f'anton woff2: {len(data)} bytes')
    return base64.b64encode(data).decode()


def grain_b64(size: int = 64, seed: int = 7) -> str:
    """灰度 PNG（color type 0, 8-bit）。CSS 侧再叠 opacity:.05 控制强度。"""
    rng = random.Random(seed)
    raw = bytearray()
    for _ in range(size):
        raw.append(0)  # PNG 每行前缀 filter byte = 0 (None)
        raw.extend(rng.randrange(256) for _ in range(size))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack('>I', len(payload)) + body + struct.pack('>I', zlib.crc32(body))

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 0, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )
    print(f'grain png: {len(png)} bytes')
    return base64.b64encode(png).decode()


def inject(css: str, marker: str, line: str) -> str:
    lines = css.split('\n')
    for i, cur in enumerate(lines):
        if marker in cur:
            assert i + 1 < len(lines), f'{marker} 后面没有可替换的行'
            lines[i + 1] = line
            return '\n'.join(lines)
    raise SystemExit(f'theme.css 里找不到标记 {marker}')


def main() -> None:
    css = CSS.read_text()
    css = inject(
        css,
        '/* GEN:ANTON */',
        f"  src: url('data:font/woff2;base64,{anton_b64()}') format('woff2');",
    )
    css = inject(
        css,
        '/* GEN:GRAIN */',
        f"  background-image: url('data:image/png;base64,{grain_b64()}');",
    )
    CSS.write_text(css)
    print(f'theme.css 已更新（{len(css)} 字符）')


if __name__ == '__main__':
    main()
