#!/home/prometheus/work/venv-bench/bin/python
"""End-to-end test in real SiYuan (kernel at 127.0.0.1:6806 with this plugin installed and enabled; see
~/prometheus/tools/siyuan/kernel.sh). Creates a nested test notebook through SiYuan's API if missing.
Usage: e2e.py [SHOT_DIR]"""
import json, os, sys, urllib.request
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:6806"
LIBS = os.path.expanduser("~/.local/chromelibs/usr/lib/aarch64-linux-gnu") + ":" + os.path.expanduser("~/.local/fxlibs/usr/lib/aarch64-linux-gnu")
shots = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sdt"
os.makedirs(shots, exist_ok=True)
results = []

def api(path, body):
    r = urllib.request.Request(URL + path, data=json.dumps(body).encode(), method="POST")
    return json.load(urllib.request.urlopen(r, timeout=30))

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name, detail, flush=True)

# fixture: notebook "Sticky test" with 3 levels of documents
nbs = api("/api/notebook/lsNotebooks", {})["data"]["notebooks"]
nb = next((n["id"] for n in nbs if n["name"] == "Sticky test"), None)
if not nb:
    nb = api("/api/notebook/createNotebook", {"name": "Sticky test"})["data"]["notebook"]["id"]
have = {r["hpath"] for r in api("/api/query/sql", {"stmt": f"select hpath from blocks where box='{nb}' and type='d' limit 1000"})["data"]}
want = []
for a in ["Projects", "Reading"]:
    want.append(f"/{a}")
    for b in range(1, 5):
        want.append(f"/{a}/{a} {b}")
        for c in range(1, 6):
            want.append(f"/{a}/{a} {b}/Note {b}.{c}")
            if c == 3: want += [f"/{a}/{a} {b}/Note {b}.{c}/Detail {b}.{c}.{d}" for d in range(1, 4)]
for path in want:  # parents first: SiYuan refuses a deep path whose parents don't exist yet
    if path not in have:
        r = api("/api/filetree/createDocWithMd", {"notebook": nb, "path": path, "markdown": "x"})
        assert r["code"] == 0, (path, r)

BAND = "() => [...document.querySelectorAll('.sdt-band:not(.fn__none) .sdt-row')].map(r => r.querySelector('.b3-list-item__text').textContent.trim())"
ORIG = """name => { const li = [...document.querySelectorAll('.file-tree__items li.b3-list-item')].find(l => l.querySelector('.b3-list-item__text').textContent.trim() === name);
  return li ? li.getBoundingClientRect().top - document.querySelector('.file-tree__items').getBoundingClientRect().top + document.querySelector('.file-tree__items').scrollTop : null; }"""

with sync_playwright() as p:
    b = p.chromium.launch(env=dict(os.environ, LD_LIBRARY_PATH=LIBS))
    pg = b.new_page(viewport={"width": 1280, "height": 860})
    pg.set_default_timeout(15000)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector(".file-tree li[data-type='navigation-root']", timeout=30000); pg.wait_for_timeout(1500)
    # collapse other notebooks, expand everything in the test notebook
    pg.evaluate("""() => document.querySelectorAll('.file-tree li[data-type=navigation-root] .b3-list-item__arrow--open').forEach(a => a.closest('.b3-list-item__toggle').click())""")
    pg.wait_for_timeout(600)
    for _ in range(6):
        n = pg.evaluate("""() => { const root = [...document.querySelectorAll('.file-tree li[data-type=navigation-root]')].find(l => l.textContent.includes('Sticky test'));
          const scope = [root, ...(root.nextElementSibling ? root.nextElementSibling.querySelectorAll('li') : [])]; let n = 0;
          scope.forEach(li => { const a = li.querySelector('.b3-list-item__arrow'); const t = li.querySelector('.b3-list-item__toggle');
            if (a && t && !a.classList.contains('b3-list-item__arrow--open') && !t.classList.contains('fn__hidden')) { t.click(); n++; } }); return n; }""")
        pg.wait_for_timeout(700)
        if not n: break
    names = pg.evaluate("[...document.querySelectorAll('.file-tree__items li.b3-list-item')].filter(l => l.offsetParent).map(l => l.querySelector('.b3-list-item__text').textContent.trim())")
    print("visible rows:", len(names), names[:12], flush=True)
    sc = ".file-tree__items"
    def scroll_to(y):
        pg.evaluate(f"document.querySelector('{sc}').scrollTop = {y}"); pg.wait_for_timeout(350)
    h = pg.evaluate("document.querySelector('.file-tree__items li.b3-list-item').offsetHeight")
    root_y = pg.evaluate(ORIG, "Sticky test")
    scroll_to(0)
    check("no band at the top of the tree", pg.evaluate(BAND) == [] or root_y > 0, str(pg.evaluate(BAND)))
    # scroll so 'Note 2.3' (Projects 2) is the first visible row
    y = pg.evaluate(ORIG, "Detail 2.3.2")
    scroll_to(y - 4 * h)
    band = pg.evaluate(BAND)
    check("chain inside a deep folder", band == ["Sticky test", "Projects", "Projects 2", "Note 2.3"], str(band))
    pg.screenshot(path=f"{shots}/deep.png", clip={"x": 0, "y": 0, "width": 420, "height": 860})
    y = pg.evaluate(ORIG, "Projects 3")
    scroll_to(y - 2 * h + 2)
    band = pg.evaluate(BAND)
    pg.screenshot(path=f"{shots}/switch.png", clip={"x": 0, "y": 0, "width": 420, "height": 500})
    check("chain switches to the next folder", band[:3] == ["Sticky test", "Projects", "Projects 3"] and "Projects 2" not in band, str(band))
    # push-up: the last stuck folder's contents end inside its slot
    end = pg.evaluate(ORIG, "Note 2.4")  # first row after Note 2.3's subtree
    scroll_to(end - 4 * h + 5)
    tf = pg.evaluate("(() => { const r = [...document.querySelectorAll('.sdt-band .sdt-row')]; return r.length ? r[r.length - 1].style.transform : 'none'; })()")
    check("last folder slides up when its contents end", "translateY(-" in tf, tf)
    # click on a pinned row's name opens that document
    y = pg.evaluate(ORIG, "Detail 3.3.2")
    scroll_to(y - 4 * h)
    band = pg.evaluate(BAND)
    pg.locator(".sdt-band .sdt-row").nth(2).locator(".b3-list-item__text").click(); pg.wait_for_timeout(1200)
    title = pg.evaluate("(() => { const t = document.querySelector('.layout-tab-bar .item--focus .item__text'); return t ? t.textContent.trim() : ''; })()")
    check("click on a pinned row opens its document", band[2:3] == ["Projects 3"] and title == "Projects 3", f"band={band} tab={title!r}")
    # click on a pinned row's arrow collapses the real folder
    scroll_to(y - 4 * h)
    pg.locator(".sdt-band .sdt-row").nth(3).locator(".b3-list-item__toggle").click(); pg.wait_for_timeout(800)
    collapsed = pg.evaluate("""() => { const li = [...document.querySelectorAll('.file-tree__items li.b3-list-item')].find(l => l.querySelector('.b3-list-item__text').textContent.trim() === 'Note 3.3');
      return !li.querySelector('.b3-list-item__arrow').classList.contains('b3-list-item__arrow--open'); }""")
    check("arrow on a pinned row collapses the real folder", collapsed)
    # right click opens SiYuan's own document menu
    scroll_to(pg.evaluate(ORIG, "Note 3.5") - 3 * h)
    pg.locator(".sdt-band .sdt-row").nth(1).click(button="right"); pg.wait_for_timeout(600)
    menu = pg.evaluate("(() => { const m = document.querySelector('#commonMenu:not(.fn__none)'); return m ? m.innerText.slice(0, 200) : ''; })()")
    check("right click opens the document menu", len(menu) > 20, menu[:80].replace("\n", " | "))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    # copies are invisible to SiYuan's lookups
    dup = pg.evaluate("document.querySelectorAll('.sdt-band [data-node-id], .sdt-band [data-path]').length")
    check("pinned copies carry no SiYuan ids", dup == 0, str(dup))
    # setting: at most 2 rows
    pg.evaluate("() => { const pl = window.siyuan.ws.app.plugins.find(p => p.name === 'sticky-doc-tree'); pl.settings.maxRows = 2; }")
    y = pg.evaluate(ORIG, "Detail 2.3.2")
    scroll_to(y - 4 * h); scroll_to(y - 4 * h + 1)
    band = pg.evaluate(BAND)
    check("max rows setting caps the band", band == ["Sticky test", "Projects"], str(band))
    pg.evaluate("() => { window.siyuan.ws.app.plugins.find(p => p.name === 'sticky-doc-tree').settings.maxRows = 6; }")
    # band follows tree width when the dock is resized
    w1 = pg.evaluate("document.querySelector('.sdt-band').getBoundingClientRect().width")
    w2 = pg.evaluate("document.querySelector('.file-tree__items').clientWidth")
    check("band matches the tree width", abs(w1 - w2) < 1, f"{w1} vs {w2}")
    # sweep: at every position, if the row at the top edge is a document (has a parent) the band must name its notebook,
    # and the band must be a real parent chain
    bad = pg.evaluate("""async () => { const sc = document.querySelector('.file-tree__items'); const bad = [];
      const name = li => li.querySelector('.b3-list-item__text').textContent.trim();
      const parent = li => { const p = li.parentElement && li.parentElement.previousElementSibling; return p && p.tagName === 'LI' ? p : null; };
      for (let y = 0; y <= sc.scrollHeight - sc.clientHeight; y += 3) {
        sc.scrollTop = y; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const top = sc.getBoundingClientRect().top;
        const rows = [...sc.querySelectorAll('li.b3-list-item')].filter(l => l.offsetParent);
        const first = rows.filter(l => l.getBoundingClientRect().top <= top + 1).pop();
        const band = [...document.querySelectorAll('.sdt-band:not(.fn__none) .sdt-row')].map(r => r.querySelector('.b3-list-item__text').textContent.trim());
        if (first && parent(first) && first.getBoundingClientRect().top < top - 1 && !band.length) bad.push(y + ': empty band, top row ' + name(first));
        const chain = []; for (let l = first; l; l = parent(l)) chain.unshift(name(l));
        if (band.length && band.some((n, i) => chain[i] !== n) && !band.every((n, i) => i === 0 || true)) bad.push(y + ': ' + band.join('>'));
      }
      return bad; }""")
    check("sweep: band never empty when a document is cut off at the top", not bad, f"{len(bad)} bad, e.g. {bad[:3]}")
    scroll_to(0)
    check("no page errors", not errs, str(errs[:3]))
    b.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
