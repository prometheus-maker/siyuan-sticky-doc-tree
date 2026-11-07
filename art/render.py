#!/home/prometheus/work/venv-bench/bin/python
import os, sys
from playwright.sync_api import sync_playwright
L = os.path.expanduser("~/.local/chromelibs/usr/lib/aarch64-linux-gnu") + ":" + os.path.expanduser("~/.local/fxlibs/usr/lib/aarch64-linux-gnu")
svg, out, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
with sync_playwright() as p:
    b = p.chromium.launch(env=dict(os.environ, LD_LIBRARY_PATH=L)); pg = b.new_page(viewport={"width": w, "height": h})
    pg.set_content(f"<style>html,body{{margin:0;background:transparent}}svg{{width:{w}px;height:{h}px;display:block}}</style>{open(svg).read()}")
    pg.screenshot(path=out, omit_background=True); b.close()
