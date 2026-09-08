import pymupdf
from pdf_thumbnail import thumbnail


def test_preview_uses_first_page_with_bounded_pixels(tmp_path):
    source = tmp_path / 'pages.pdf'
    with pymupdf.open() as pdf:
        for color in [(1, 0, 0), (0, 0, 1)]:
            page = pdf.new_page(width=600, height=800)
            page.draw_rect(page.rect, color=color, fill=color)
        pdf.save(source)
    data = thumbnail(source)
    assert data[:4] == b'\x89PNG'
    assert len(data) < 128 * 1024
    pixmap = pymupdf.Pixmap(data)
    assert pixmap.width <= 168 and pixmap.height <= 224
    red, green, blue = pixmap.pixel(pixmap.width // 2, pixmap.height // 2)
    assert red > 230 and green < 20 and blue < 20
