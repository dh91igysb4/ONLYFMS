#!/usr/bin/env python3
"""마을회관 그림 → src/games/fishing/hallArt.ts (생성 파일).

  python3 scripts/build-hall-art.py

scripts/hall-art/exterior.py(외관 v2), interior.py(1층 실내 배경, 평면 v7), gallery.py(2층 전시관)를 그려
스프라이트 데이터(행 문자열 + 팔레트)로 바꾼다. hallArt.ts는 직접 고치지 않는다.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'hall-art'))
import exterior  # noqa: E402
import interior  # noqa: E402
import gallery  # noqa: E402

OUT = os.path.join(HERE, '..', 'src', 'games', 'fishing', 'hallArt.ts')
# '.'은 투명. 따옴표·백슬래시는 TS 문자열을 깨므로 뺀다
CHARS = [chr(c) for c in range(33, 127) if chr(c) not in ".'\\`"] + [chr(c) for c in range(0xC0, 0x24F)]


def to_sprite(img):
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    palette = {}
    rows = []
    for y in range(h):
        line = []
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                line.append('.')
                continue
            hexc = '#%02x%02x%02x' % (r, g, b)
            if hexc not in palette:
                if len(palette) >= len(CHARS):
                    raise SystemExit('too many colours')
                palette[hexc] = CHARS[len(palette)]
            line.append(palette[hexc])
        rows.append(''.join(line))
    return w, h, rows, {v: k for k, v in palette.items()}


def ts(name, sp):
    w, h, rows, pal = sp
    pal_s = ', '.join("'%s': '%s'" % (k, v) for k, v in pal.items())
    rows_s = '\n'.join("    '%s'," % r for r in rows)
    return f"export const {name} = {{\n  w: {w},\n  h: {h},\n  palette: {{ {pal_s} }} as Record<string, string>,\n  rows: [\n{rows_s}\n  ],\n}}\n"


def main():
    body = '// 생성 파일: python3 scripts/build-hall-art.py — 직접 고치지 않는다\n'
    body += '// 마을회관 외관(바닥 정렬, 마을 건물 사각형 왼쪽 위에서 x 0)과 1층 실내 배경(672×288 = 42×18칸)\n\n'
    body += ts('HALL_EXTERIOR', to_sprite(exterior.render())) + '\n'
    body += ts('HALL_INTERIOR', to_sprite(interior.render())) + '\n'
    body += ts('HALL_GALLERY', to_sprite(gallery.render()))
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(body)
    print('wrote', os.path.relpath(OUT))


if __name__ == '__main__':
    main()
