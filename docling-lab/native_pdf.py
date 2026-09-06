"""Extract font/character evidence without re-encoding embedded page images."""
def native_dict(page, *, raw=False):
    import pymupdf
    flags=pymupdf.TEXTFLAGS_RAWDICT if raw else pymupdf.TEXTFLAGS_DICT
    return page.get_text('rawdict' if raw else 'dict',flags=flags & ~pymupdf.TEXT_PRESERVE_IMAGES)
