#!/home/prometheus/work/venv-bench/bin/python
"""preview.png: real SiYuan with a realistic notebook, the tree scrolled deep so the parent path is pinned.
Needs the kernel on :6806 with the plugin enabled. Usage: preview.py OUT.png"""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright
L = os.path.expanduser("~/.local/chromelibs/usr/lib/aarch64-linux-gnu") + ":" + os.path.expanduser("~/.local/fxlibs/usr/lib/aarch64-linux-gnu")
def api(p, b):
    for _ in range(20):  # a brand-new notebook answers "document metadata is not ready" for a few seconds
        r = json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:6806" + p, data=json.dumps(b).encode(), method="POST"), timeout=30))
        if r["code"] == 0: return r
        time.sleep(1)
    raise SystemExit(f"{p} failed: {r}")
nbs = api("/api/notebook/lsNotebooks", {})["data"]["notebooks"]
nb = next((n["id"] for n in nbs if n["name"] == "Thesis"), None)
if not nb:
    nb = api("/api/notebook/createNotebook", {"name": "Thesis"})["data"]["notebook"]["id"]
if api("/api/query/sql", {"stmt": f"select count(*) as n from blocks where box='{nb}' and type='d'"})["data"][0]["n"] < 10:
    tree = {"Literature review": {"Transformers": ["Attention is all you need", "BERT", "Scaling laws"], "Retrieval": ["RAG", "Dense passage retrieval", "ColBERT"]},
            "Experiments": {"2026-10 baseline": ["Setup", "Results", "What went wrong"],
                            "2026-11 ablations": ["Plan", "Run log", "Learning rate sweep", "Batch size sweep", "Tokenizer variants", "Results table", "Notes for advisor"]},
            "Chapters": {f"{i} {n}": ["Outline", "Draft", "Advisor comments"] for i, n in enumerate(["Introduction", "Background", "Method", "Evaluation", "Discussion", "Conclusion"], 1)}}
    for a, subs in tree.items():
        api("/api/filetree/createDocWithMd", {"notebook": nb, "path": f"/{a}", "markdown": ""})
        for b, docs in subs.items():
            api("/api/filetree/createDocWithMd", {"notebook": nb, "path": f"/{a}/{b}", "markdown": ""})
            for d in docs:
                api("/api/filetree/createDocWithMd", {"notebook": nb, "path": f"/{a}/{b}/{d}", "markdown": f"Notes on {d.lower()}."})
                if d == "Learning rate sweep":
                    for e in ["lr 1e-3", "lr 3e-4", "lr 1e-4", "Warmup 500 steps", "Cosine schedule", "Summary"]:
                        api("/api/filetree/createDocWithMd", {"notebook": nb, "path": f"/{a}/{b}/{d}/{e}", "markdown": f"Run notes: {e}."})
with sync_playwright() as p:
    b = p.chromium.launch(env=dict(os.environ, LD_LIBRARY_PATH=L)); pg = b.new_page(viewport={"width": 1024, "height": 768})
    pg.goto("http://127.0.0.1:6806"); pg.wait_for_selector(".file-tree li[data-type='navigation-root']", timeout=30000); pg.wait_for_timeout(1500)
    pg.evaluate("""() => document.querySelectorAll('.file-tree li[data-type=navigation-root] .b3-list-item__arrow--open').forEach(a => a.closest('.b3-list-item__toggle').click())""")
    pg.wait_for_timeout(600)
    for _ in range(5):
        n = pg.evaluate("""() => { const root = [...document.querySelectorAll('.file-tree li[data-type=navigation-root]')].find(l => l.textContent.includes('Thesis'));
          const scope = [root, ...(root.nextElementSibling ? root.nextElementSibling.querySelectorAll('li') : [])]; let n = 0;
          scope.forEach(li => { const a = li.querySelector('.b3-list-item__arrow'); const t = li.querySelector('.b3-list-item__toggle');
            if (a && t && !a.classList.contains('b3-list-item__arrow--open') && !t.classList.contains('fn__hidden')) { t.click(); n++; } }); return n; }""")
        pg.wait_for_timeout(700)
        if not n: break
    pg.evaluate("document.querySelectorAll('.layout-tab-bar .item__close').forEach(c => c.click())"); pg.wait_for_timeout(500)
    pg.mouse.click(975, 500) if pg.locator("text=Welcome to SiYuan").count() and pg.locator("text=Welcome to SiYuan").is_visible() else None
    # open a run note and scroll so its whole folder chain is pinned
    pg.evaluate("""() => { const li = [...document.querySelectorAll('.file-tree__items li')].find(l => l.querySelector('.b3-list-item__text').textContent.trim() === 'lr 1e-4'); li.click(); }""")
    pg.wait_for_timeout(1500)
    pg.evaluate("""() => { const sc = document.querySelector('.file-tree__items'); const li = [...sc.querySelectorAll('li')].find(l => l.querySelector('.b3-list-item__text').textContent.trim() === 'lr 1e-4');
       sc.scrollTop += li.getBoundingClientRect().top - sc.getBoundingClientRect().top - 6 * 29; }""")
    pg.wait_for_timeout(800); pg.mouse.move(700, 600)
    pg.screenshot(path=sys.argv[1]); b.close()
