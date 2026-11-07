import { App, getModelByDockType, openTab, Plugin, Setting } from "siyuan";
import { stuckRows, TreeRow } from "./stick";

interface Settings { maxRows: number }
const DEFAULTS: Settings = { maxRows: 6 };
const STORE = "settings.json";
const EN: Record<string, string> = {
	maxRows: "Rows to keep at the top", maxRowsDesc: "The most parent levels shown at once. Deeper ones scroll away as usual.",
};

/**
 * How one kind of document tree answers the questions the band needs. SiYuan up to 3.8.9 renders the whole open tree
 * as nested lists (every parent row is in the DOM). From 3.8.10 the tree is a flat, virtually scrolled list: only rows
 * near the viewport exist, and the parent chain comes from the tree's own controller.
 */
interface Adapter<K> {
	rows(): HTMLElement[];                    // rendered rows, top to bottom
	keyOf(li: HTMLElement): K | null;
	row(key: K): TreeRow<K> | null;
	element(key: K): HTMLElement | null;      // the rendered row, if it is rendered
	fallback(key: K): HTMLElement | null;     // a stand-in row when it is not rendered
	reveal(key: K, slot: number, h: number): Promise<HTMLElement | null>;
	open(key: K): boolean;                    // open the document without scrolling; false if not possible
}

/** SiYuan <= 3.8.9: nested <ul>, a row's children are the <ul> right after it. */
class NestedTree implements Adapter<HTMLElement> {
	constructor(private scroller: HTMLElement) {}
	rows() { return Array.from(this.scroller.querySelectorAll<HTMLElement>("li.b3-list-item")).filter((li) => li.offsetParent !== null); }
	keyOf(li: HTMLElement) { return li; }
	private parentOf(li: HTMLElement): HTMLElement | null {
		const prev = li.parentElement?.previousElementSibling;
		return prev instanceof HTMLElement && prev.tagName === "LI" && prev.classList.contains("b3-list-item") ? prev : null;
	}
	row(li: HTMLElement): TreeRow<HTMLElement> {
		const r = li.getBoundingClientRect();
		const kids = li.nextElementSibling;
		const open = kids instanceof HTMLElement && kids.tagName === "UL" && kids.offsetParent !== null && kids.childElementCount > 0;
		return { key: li, top: r.top, end: open ? Math.max(r.bottom, kids!.getBoundingClientRect().bottom) : r.bottom, open, parent: this.parentOf(li) };
	}
	element(li: HTMLElement) { return li.isConnected ? li : null; }
	fallback() { return null; }
	async reveal(li: HTMLElement) { return li; }
	open() { return false; }
}

interface DocTreeItem { occurrenceKey: string; parentKey?: string; id: string; name: string; kind: "document" | "notebook"; depth: number; subFileCount: number }
interface DocTreeController {
	getItem(key: string): DocTreeItem | undefined;
	getMountedElement(key: string): HTMLElement | undefined;
	isExpanded(key: string): boolean;
	model?: { indexOf(key: string): number };
}

/** SiYuan >= 3.8.10: flat virtual list of li.file-tree__row[data-tree-key]; the controller knows parents and state. */
class VirtualTree implements Adapter<string> {
	private cache = new Map<string, HTMLElement>(); // last look of every row seen, for parents that are not rendered now
	constructor(private scroller: HTMLElement, private ctl: DocTreeController, private app: App) {}
	rows() {
		const list = Array.from(this.scroller.querySelectorAll<HTMLElement>("ul[role=tree] > li.file-tree__row[data-tree-key]"));
		for (const li of list) {
			const k = li.dataset.treeKey!;
			this.cache.delete(k);
			this.cache.set(k, li.cloneNode(true) as HTMLElement);
		}
		while (this.cache.size > 3000) this.cache.delete(this.cache.keys().next().value as string);
		return list;
	}
	keyOf(li: HTMLElement) { return li.dataset.treeKey || null; }
	private chain(key: string): string[] {
		const out: string[] = [];
		for (let k: string | undefined = key; k && out.length < 64; k = this.ctl.getItem(k)?.parentKey) out.unshift(k);
		return out;
	}
	row(key: string): TreeRow<string> | null {
		const item = this.ctl.getItem(key);
		if (!item) return null;
		const el = this.element(key);
		// A parent that is not rendered lies above everything rendered (parents always come before their children).
		const top = el ? el.getBoundingClientRect().top : -Infinity;
		const open = this.ctl.isExpanded(key);
		let end = el ? el.getBoundingClientRect().bottom : -Infinity;
		if (open) {
			// the subtree ends where the first rendered row after its descendants starts
			end = Infinity;
			let inside = false;
			for (const li of this.rows()) {
				const k = li.dataset.treeKey!;
				if (k === key) continue;
				const desc = this.chain(k).includes(key);
				if (desc) inside = true;
				else if (inside) { end = li.getBoundingClientRect().top; break; }
			}
		}
		return { key, top, end, open, parent: item.parentKey ?? null };
	}
	element(key: string) {
		const el = this.ctl.getMountedElement(key);
		return el && el.isConnected && this.scroller.contains(el) ? el : null;
	}
	fallback(key: string): HTMLElement | null {
		const cached = this.cache.get(key);
		if (cached) return cached.cloneNode(true) as HTMLElement;
		const item = this.ctl.getItem(key);
		if (!item) return null;
		const li = document.createElement("li");
		li.className = "b3-list-item file-tree__row";
		li.style.setProperty("--file-tree-depth", String(item.depth));
		li.innerHTML = `<span class="b3-list-item__toggle b3-list-item__toggle--hl"><svg class="b3-list-item__arrow b3-list-item__arrow--open"><use xlink:href="#iconRight"></use></svg></span>`
			+ `<span class="b3-list-item__icon"><svg><use xlink:href="#${item.kind === "notebook" ? "iconNotebook" : "iconFile"}"></use></svg></span><span class="b3-list-item__text"></span>`;
		(li.querySelector(".b3-list-item__text") as HTMLElement).textContent = item.name.replace(/\.sy$/, "");
		return li;
	}
	async reveal(key: string, slot: number, h: number): Promise<HTMLElement | null> {
		let el = this.element(key);
		if (el) return el;
		const idx = this.ctl.model?.indexOf(key) ?? -1;
		if (idx < 0) return null;
		this.scroller.scrollTop = Math.max(0, idx * h - slot * h);
		for (let i = 0; i < 10 && !el; i++) {
			await new Promise((r) => requestAnimationFrame(() => r(null)));
			el = this.element(key);
		}
		return el;
	}
	open(key: string): boolean {
		const item = this.ctl.getItem(key);
		if (!item || item.kind !== "document") return false;
		openTab({ app: this.app, doc: { id: item.id } });
		return true;
	}
}

/** One document tree: its scroll box, the band drawn over it, and the observers that keep the band current. */
class Sticky<K> {
	band: HTMLElement;
	private rowsCache: HTMLElement[] = [];
	private dirty = true;
	private frame = 0;
	private shown: K[] = [];
	private h = 28;
	private mo: MutationObserver;
	private ro: ResizeObserver;
	private onScroll = () => { this.dirty = true; this.schedule(); };

	constructor(public scroller: HTMLElement, private tree: Adapter<K>, private max: () => number) {
		const host = scroller.parentElement as HTMLElement;
		host.classList.add("sdt-host");
		this.band = document.createElement("div");
		this.band.className = "sdt-band fn__none";
		host.append(this.band);
		scroller.addEventListener("scroll", this.onScroll, { passive: true });
		this.mo = new MutationObserver(() => { this.dirty = true; this.schedule(); });
		this.mo.observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-expanded"] });
		this.ro = new ResizeObserver(() => this.schedule());
		this.ro.observe(scroller);
		this.band.addEventListener("click", (e) => void this.forward(e));
		this.band.addEventListener("contextmenu", (e) => void this.forward(e));
		this.schedule();
	}

	destroy() {
		this.scroller.removeEventListener("scroll", this.onScroll);
		this.mo.disconnect();
		this.ro.disconnect();
		cancelAnimationFrame(this.frame);
		this.band.remove();
		this.scroller.parentElement?.classList.remove("sdt-host");
	}

	schedule() {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
	}

	private list(): HTMLElement[] {
		if (this.dirty) { this.rowsCache = this.tree.rows(); this.dirty = false; }
		return this.rowsCache;
	}

	private rowAt = (y: number): TreeRow<K> | null => {
		const list = this.list();
		let lo = 0, hi = list.length - 1;
		// the last row starting at or above y: a y in the small gap between two rows belongs to the upper one
		let found = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (list[mid].getBoundingClientRect().top <= y) { found = mid; lo = mid + 1; } else hi = mid - 1;
		}
		if (found < 0) return null;
		const r = list[found].getBoundingClientRect();
		const key = y < r.bottom + 4 ? this.tree.keyOf(list[found]) : null;
		return key === null ? null : this.tree.row(key);
	};

	private rowOf = (key: K) => this.tree.row(key);

	draw() {
		if (!this.scroller.isConnected) return;
		const list = this.list();
		// slot height = distance between two rows (SiYuan rows are 28 px tall but 29 px apart)
		const h = this.h = list.length > 1 ? Math.round(list[1].getBoundingClientRect().top - list[0].getBoundingClientRect().top) || 28 : list[0]?.offsetHeight || 28;
		const box = this.scroller.getBoundingClientRect();
		const { rows, shift } = this.scroller.scrollTop > 0 ? stuckRows(box.top, h, this.max(), this.rowAt, this.rowOf) : { rows: [], shift: 0 };
		if (!rows.length) { this.band.classList.add("fn__none"); this.shown = []; return; }
		this.band.classList.remove("fn__none");
		this.band.style.top = `${this.scroller.offsetTop}px`;
		this.band.style.left = `${this.scroller.offsetLeft}px`;
		this.band.style.width = `${this.scroller.clientWidth}px`;
		this.band.style.height = `${rows.length * h + shift}px`;
		this.band.style.setProperty("--sdt-bg", this.background());
		const same = rows.length === this.shown.length && rows.every((r, i) => r === this.shown[i]) && this.band.dataset.h === String(h);
		rows.forEach((key, i) => {
			const old = same ? this.band.children[i] as HTMLElement : undefined;
			const src = this.tree.element(key);
			const sig = src ? this.sig(src) : "fallback";
			if (old && old.dataset.sig === sig) return;
			const c = this.copy(src ?? this.tree.fallback(key), i, h, sig);
			if (old) old.replaceWith(c); else if (!same) { if (i === 0) this.band.innerHTML = ""; this.band.append(c); }
		});
		this.shown = rows;
		this.band.dataset.h = String(h);
		const last = this.band.children[rows.length - 1] as HTMLElement | undefined;
		if (last) last.style.transform = shift ? `translateY(${shift}px)` : "";
	}

	/** The colour the tree is painted on (themes differ), so the band looks like part of the tree. */
	private background(): string {
		for (let el: HTMLElement | null = this.scroller; el; el = el.parentElement) {
			const c = getComputedStyle(el).backgroundColor;
			if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
		}
		return "var(--b3-theme-background)";
	}

	private sig(li: HTMLElement) { return li.className + "|" + li.getAttribute("aria-expanded") + "|" + li.textContent; }

	/** A look-alike of the row: same classes and inner markup, but without ids, so SiYuan's own lookups never find it. */
	private copy(li: HTMLElement | null, i: number, h: number, sig: string): HTMLElement {
		const c = (li ? li.cloneNode(true) : document.createElement("li")) as HTMLElement;
		for (const el of [c, ...Array.from(c.querySelectorAll<HTMLElement>("*"))]) {
			for (const a of Array.from(el.attributes)) {
				if (a.name.startsWith("data-") || a.name.startsWith("aria-") || ["draggable", "id", "role", "tabindex"].includes(a.name)) el.removeAttribute(a.name);
			}
			el.classList.remove("popover__block", "ariaLabel");
		}
		c.classList.add("sdt-row", "b3-list-item");
		c.dataset.sdtIndex = String(i);
		c.dataset.sig = sig;
		c.style.top = `${i * h}px`;
		c.style.height = `${h}px`;
		return c;
	}

	/** A click on a copy acts on the same spot of the real row: open, expand/collapse, the "more" menu. */
	private async forward(e: MouseEvent) {
		const t = e.target as HTMLElement;
		const copy = t.closest<HTMLElement>(".sdt-row");
		if (!copy) return;
		const slot = Number(copy.dataset.sdtIndex);
		const key = this.shown[slot];
		if (key === undefined) return;
		e.preventDefault();
		e.stopPropagation();
		const path: number[] = [];
		for (let el: HTMLElement = t; el !== copy; el = el.parentElement as HTMLElement) path.unshift(Array.prototype.indexOf.call(el.parentElement!.children, el));
		const onName = !t.closest(".b3-list-item__toggle, .b3-list-item__action");
		let li = this.tree.element(key);
		// a parent that is scrolled out of the DOM: open its document directly, or bring it back for the arrow and menu
		if (!li && e.type === "click" && onName && this.tree.open(key)) return;
		if (!li) li = await this.tree.reveal(key, slot, this.h);
		if (!li) return;
		let target: Element = li;
		for (const i of path) { const next = target.children[i]; if (!next) break; target = next; }
		const r = (target as HTMLElement).getBoundingClientRect();
		target.dispatchEvent(new MouseEvent(e.type, {
			bubbles: true, cancelable: true, view: window, button: e.button, buttons: e.buttons, detail: e.detail,
			clientX: r.left + Math.min(e.offsetX, r.width - 1), clientY: r.top + r.height / 2,
			ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
		}));
		this.dirty = true;
		this.schedule();
	}
}

export default class StickyDocTree extends Plugin {
	settings: Settings = { ...DEFAULTS };
	private trees = new Map<HTMLElement, Sticky<unknown>>();
	private timer = 0;

	t(key: string): string {
		const v = this.i18n?.[key];
		return typeof v === "string" && v ? v : EN[key];
	}

	async onload() {
		const saved = (await this.loadData(STORE).catch(() => null)) as Partial<Settings> | null;
		this.settings = { ...DEFAULTS, ...(saved || {}) };
		const select = document.createElement("select");
		select.className = "b3-select fn__flex-center fn__size200";
		for (let n = 1; n <= 10; n++) select.add(new Option(String(n), String(n), false, n === this.settings.maxRows));
		select.addEventListener("change", () => {
			this.settings.maxRows = Number(select.value);
			void this.saveData(STORE, this.settings);
			this.trees.forEach((s) => s.schedule());
		});
		this.setting = new Setting({});
		this.setting.addItem({ title: this.t("maxRows"), description: this.t("maxRowsDesc"), actionElement: select });
	}

	onLayoutReady() {
		// The document tree can be closed, reopened or moved to another dock at any time; look for it once a second.
		this.scan();
		this.timer = window.setInterval(() => this.scan(), 1000);
	}

	private adapter(el: HTMLElement): Adapter<unknown> | null {
		if (!el.querySelector("li.b3-list-item")) return null; // wait until the tree has rendered, so the kind is known
		if (el.querySelector("li.file-tree__row[data-tree-key]")) {
			let ctl: DocTreeController | undefined;
			try { ctl = (getModelByDockType("file") as { docTree?: DocTreeController } | undefined)?.docTree; } catch { ctl = undefined; }
			return ctl ? new VirtualTree(el, ctl, this.app) as Adapter<unknown> : null;
		}
		return new NestedTree(el) as Adapter<unknown>;
	}

	private scan() {
		document.querySelectorAll<HTMLElement>(".file-tree .file-tree__items").forEach((el) => {
			if (this.trees.has(el)) return;
			const a = this.adapter(el);
			if (a) this.trees.set(el, new Sticky(el, a, () => this.settings.maxRows));
		});
		this.trees.forEach((s, el) => { if (!el.isConnected) { s.destroy(); this.trees.delete(el); } });
	}

	onunload() {
		window.clearInterval(this.timer);
		this.trees.forEach((s) => s.destroy());
		this.trees.clear();
	}

	async uninstall() {
		await this.removeData(STORE).catch(() => undefined);
	}
}
