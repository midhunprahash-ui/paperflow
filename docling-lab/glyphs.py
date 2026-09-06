"""Tight Type 1 glyph bounds from embedded outlines, without changing pixels."""
from __future__ import annotations

from fontTools.agl import UV2AGL
from fontTools.pens.boundsPen import BoundsPen
from fontTools.t1Lib import T1Font


class GlyphBounds:
    def __init__(self, pdf):
        self.fonts = {}; self.bounds = {}
        for page in pdf:
            for entry in page.get_fonts():
                name = entry[3].split('+')[-1]
                if name in self.fonts:
                    continue
                self.fonts[name] = None
                if entry[2] != 'Type1' or not entry[0]:
                    continue
                try:
                    _, ext, _, data = pdf.extract_font(entry[0])
                    if ext != 'pfa' or len(data) > 10_000_000:
                        continue
                    font = T1Font.__new__(T1Font)
                    font.data = data; font.encoding = 'ascii'
                    glyphs = font.getGlyphSet()
                    self.fonts[name] = (glyphs, font['FontMatrix'])
                except (ValueError, KeyError, AssertionError, TypeError):
                    continue

    def get(self, font_name, size, char):
        name = font_name.split('+')[-1]
        font = self.fonts.get(name)
        glyph_name = UV2AGL.get(ord(char['c'])) if len(char['c']) == 1 else None
        if not font or not glyph_name or glyph_name not in font[0]:
            return None
        key = (name, glyph_name)
        if key not in self.bounds:
            pen = BoundsPen(font[0]); font[0][glyph_name].draw(pen)
            self.bounds[key] = pen.bounds
        bounds = self.bounds[key]
        if bounds is None:
            return None
        a,b,c,d,e,f = font[1]
        ox, oy = char['origin']
        points = [(ox+size*(a*x+c*y+e), oy-size*(b*x+d*y+f))
                  for x in (bounds[0],bounds[2]) for y in (bounds[1],bounds[3])]
        return [min(p[0] for p in points), min(p[1] for p in points),
                max(p[0] for p in points), max(p[1] for p in points)]
