// Which rows of a tree stick to the top while it scrolls. Pure logic, no DOM, so it can be unit-tested.
// Coordinates: y grows downwards; `top` is the top edge of the visible area, in the same coordinates as the rows.

export interface TreeRow<T> {
	key: T;
	top: number;      // top of the row itself
	end: number;      // bottom of the row's whole open subtree (= bottom of the row when it is closed)
	open: boolean;    // has visible children
	parent: T | null; // row of the parent folder / notebook
}

export interface Stuck<T> { rows: T[]; shift: number } // shift (<= 0) moves the last stuck row up

/**
 * rowAt(y): the row covering height y; row(key): look a row up by key.
 * Slot i (0-based) is the band [top + i*h, top + (i+1)*h). The row shown in slot i is the depth-i ancestor of the row
 * under that slot, as long as it starts above the slot and the chain matches the rows already stuck.
 */
export function stuckRows<T>(top: number, h: number, max: number,
	rowAt: (y: number) => TreeRow<T> | null, row: (key: T) => TreeRow<T> | null): Stuck<T> {
	const rows: T[] = [];
	for (let i = 0; i < max; i++) {
		const y = top + i * h;
		const under = rowAt(y + h / 2);
		if (!under) break;
		const chain: TreeRow<T>[] = [];
		for (let r: TreeRow<T> | null = under; r; r = r.parent === null ? null : row(r.parent)) chain.unshift(r);
		if (chain.slice(0, i).some((r, j) => r.key !== rows[j])) break;
		const node = chain[i];
		if (!node || !node.open || node.top >= y) break;
		// a folder whose contents end inside its own slot has nothing left to label
		if (node.end <= y + h / 2) break;
		rows.push(node.key);
	}
	let shift = 0;
	if (rows.length) {
		const last = row(rows[rows.length - 1]);
		const slotBottom = top + rows.length * h;
		if (last && last.end < slotBottom) shift = Math.max(-h, last.end - slotBottom);
	}
	return { rows, shift };
}
