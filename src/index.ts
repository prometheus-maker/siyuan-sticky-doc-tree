import { Plugin, Setting } from "siyuan";
import { stuckRows, TreeRow } from "./stick";

interface Settings { maxRows: number }
const DEFAULTS: Settings = { maxRows: 6 };
const STORE = "settings.json";
const EN: Record<string, string> = {
	maxRows: "Rows to keep at the top", maxRowsDesc: "The most parent levels shown at once. Deeper ones scroll away as usual.",
};

/** One document tree: its scroll box, the band drawn over it, and the observers that keep the band current. */
class Sticky {
	band: HTMLElement;
	private rows: HTMLElement[] = [];
	private dirty = true;
	private frame = 0;
	private shown: HTMLElement[] = [];
	private mo: MutationObserver;
	private ro: ResizeObserver;
	private onScroll = () => this.schedule();

	constructor(public scroller: HTMLElement, private max: () => number) {
		const host = scroller.parentElement as HTMLElement;
		host.classList.add("sdt-host");
		this.band = document.createElement("div");
		this.band.className = "sdt-band fn__none";
		host.append(this.band);
		scroller.addEventListener("scroll", this.onScroll, { passive: true });
		this.mo = new MutationObserver((muts) => {
			if (muts.some((m) => m.type === "childList" || (m.target as Element).tagName === "UL")) this.dirty = true;
			this.schedule();
		});
		this.mo.observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
		this.ro = new ResizeObserver(() => this.schedule());
		this.ro.observe(scroller);
		this.band.addEventListener("click", (e) => this.forward(e));
		this.band.addEventListener("contextmenu", (e) => this.forward(e));
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

	/** Visible rows in document order, which is also top-to-bottom order. */
	private list(): HTMLElement[] {
		if (this.dirty) {
			this.rows = Array.from(this.scroller.querySelectorAll<HTMLElement>("li.b3-list-item")).filter((li) => li.offsetParent !== null);
			this.dirty = false;
		}
		return this.rows;
	}

	private parentOf(li: HTMLElement): HTMLElement | null {
		const prev = li.parentElement?.previousElementSibling;
		return prev instanceof HTMLElement && prev.tagName === "LI" && prev.classList.contains("b3-list-item") ? prev : null;
	}

	private row = (li: HTMLElement): TreeRow<HTMLElement> => {
		const r = li.getBoundingClientRect();
		const kids = li.nextElementSibling;
		const open = kids instanceof HTMLElement && kids.tagName === "UL" && kids.offsetParent !== null && kids.childElementCount > 0;
		return { key: li, top: r.top, end: open ? Math.max(r.bottom, kids!.getBoundingClientRect().bottom) : r.bottom, open, parent: this.parentOf(li) };
	};

	private rowAt = (y: number): TreeRow<HTMLElement> | null => {
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
		return y < r.bottom + 4 ? this.row(list[found]) : null;
	};

	draw() {
		if (!this.scroller.isConnected) return;
		const list = this.list();
		// slot height = distance between two rows (SiYuan rows are 28 px tall but 29 px apart)
		const h = list.length > 1 ? Math.round(list[1].getBoundingClientRect().top - list[0].getBoundingClientRect().top) || 28 : list[0]?.offsetHeight || 28;
		const box = this.scroller.getBoundingClientRect();
		const { rows, shift } = this.scroller.scrollTop > 0 ? stuckRows(box.top, h, this.max(), this.rowAt, this.row) : { rows: [], shift: 0 };
		const same = rows.length === this.shown.length && rows.every((r, i) => r === this.shown[i]);
		if (!rows.length) { this.band.classList.add("fn__none"); this.shown = []; return; }
		this.band.classList.remove("fn__none");
		this.band.style.top = `${this.scroller.offsetTop}px`;
		this.band.style.left = `${this.scroller.offsetLeft}px`;
		this.band.style.width = `${this.scroller.clientWidth}px`;
		this.band.style.height = `${rows.length * h + shift}px`;
		this.band.style.setProperty("--sdt-bg", this.background());
		if (!same || this.band.dataset.h !== String(h)) {
			this.band.innerHTML = "";
			rows.forEach((li, i) => this.band.append(this.copy(li, i, h)));
			this.shown = rows;
			this.band.dataset.h = String(h);
		} else {
			// focus / name changes on the originals: refresh the copies cheaply
			rows.forEach((li, i) => {
				const c = this.band.children[i] as HTMLElement;
				if (c.dataset.sig !== this.sig(li)) c.replaceWith(this.copy(li, i, h));
			});
		}
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

	private sig(li: HTMLElement) { return li.className + "|" + li.textContent; }

	/** A look-alike of the row: same classes and inner markup, but without ids, so SiYuan's own lookups never find it. */
	private copy(li: HTMLElement, i: number, h: number): HTMLElement {
		const c = li.cloneNode(true) as HTMLElement;
		for (const el of [c, ...Array.from(c.querySelectorAll<HTMLElement>("*"))]) {
			for (const a of Array.from(el.attributes)) if (a.name.startsWith("data-") || a.name === "draggable" || a.name === "id") el.removeAttribute(a.name);
			el.classList.remove("popover__block", "ariaLabel");
		}
		c.dataset.sdtIndex = String(i);
		c.dataset.sig = this.sig(li);
		c.classList.add("sdt-row");
		c.style.top = `${i * h}px`;
		c.style.height = `${h}px`;
		return c;
	}

	/** A click on a copy acts on the same spot of the real row: open, expand/collapse, the "more" menu. */
	private forward(e: MouseEvent) {
		const t = e.target as HTMLElement;
		const copy = t.closest<HTMLElement>(".sdt-row");
		if (!copy) return;
		const li = this.shown[Number(copy.dataset.sdtIndex)];
		if (!li) return;
		const path: number[] = [];
		for (let el: HTMLElement = t; el !== copy; el = el.parentElement as HTMLElement) path.unshift(Array.prototype.indexOf.call(el.parentElement!.children, el));
		let target: Element = li;
		for (const i of path) { const next = target.children[i]; if (!next) break; target = next; }
		e.preventDefault();
		e.stopPropagation();
		const r = (target as HTMLElement).getBoundingClientRect();
		target.dispatchEvent(new MouseEvent(e.type, {
			bubbles: true, cancelable: true, view: window, button: e.button, buttons: e.buttons, detail: e.detail,
			clientX: r.left + Math.min(e.offsetX, r.width - 1), clientY: r.top + r.height / 2,
			ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
		}));
		this.schedule();
	}
}

export default class StickyDocTree extends Plugin {
	settings: Settings = { ...DEFAULTS };
	private trees = new Map<HTMLElement, Sticky>();
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

	private scan() {
		document.querySelectorAll<HTMLElement>(".file-tree .file-tree__items").forEach((el) => {
			if (!this.trees.has(el)) this.trees.set(el, new Sticky(el, () => this.settings.maxRows));
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
