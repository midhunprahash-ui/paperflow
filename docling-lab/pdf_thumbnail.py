"""Render only page one, with a fixed pixel budget and no OCR dependencies."""
import sys
import pymupdf


def thumbnail(source):
    with pymupdf.open(source) as pdf:
        if pdf.needs_pass or not pdf.page_count:
            raise ValueError("A readable PDF is required")
        page = pdf[0]
        scale = min(168 / page.rect.width, 224 / page.rect.height)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale),
                                 colorspace=pymupdf.csRGB, alpha=False)
        return pixmap.tobytes("png")


if __name__ == "__main__":
    sys.stdout.buffer.write(thumbnail(sys.argv[1]))
