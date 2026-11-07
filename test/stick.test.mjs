import { test } from "node:test";
import assert from "node:assert/strict";
import { stuckRows } from "../build/stick.mjs";

// Build rows from an outline: [name, depth, open?]; each row is 10 px high, laid out top to bottom.
function tree(lines, gap = 0) {
	const rows = [], stack = [];
	lines.forEach(([key, depth], i) => {
		stack.length = depth;
		rows.push({ key, top: i * (10 + gap), end: i * (10 + gap) + 10, open: false, parent: depth ? stack[depth - 1] : null, depth });
		stack[depth] = key;
	});
	for (const r of rows) {
		const kids = rows.filter((x) => x.top > r.top);
		const stop = kids.findIndex((x) => x.depth <= r.depth);
		const sub = stop === -1 ? kids : kids.slice(0, stop);
		if (sub.length) { r.open = true; r.end = sub[sub.length - 1].top + 10; }
	}
	const by = new Map(rows.map((r) => [r.key, r]));
	return {
		// like the DOM side: a y in the gap below a row belongs to that row
		rowAt: (y) => [...rows].reverse().find((r) => y >= r.top && y < r.top + 10 + gap) ?? null,
		row: (k) => by.get(k) ?? null,
	};
}

const T = tree([
	["NB", 0], ["A", 1], ["A1", 2], ["A1a", 3], ["A1b", 3], ["A1c", 3], ["A2", 2], ["B", 1], ["B1", 2], ["B2", 2], ["B3", 2], ["B4", 2],
]);
const at = (top, max = 5) => stuckRows(top, 10, max, T.rowAt, T.row);

test("nothing sticks at the very top", () => {
	assert.deepEqual(at(0).rows, []);
});

test("rows covered by the sticky band stick too", () => {
	// at top=5 the band of 3 slots covers y 5..35, which hides NB, A and A1 -> all three stick
	assert.deepEqual(at(5).rows, ["NB", "A", "A1"]);
});

test("deep scroll shows the full parent chain", () => {
	assert.deepEqual(at(22).rows, ["NB", "A", "A1"]);
});

test("chain switches when entering the next folder", () => {
	assert.deepEqual(at(75).rows, ["NB", "B"]);
});

test("max rows caps the chain", () => {
	assert.deepEqual(at(22, 2).rows, ["NB", "A"]);
});

test("last stuck folder is pushed up when its contents end", () => {
	// A1's subtree ends at y=60. At top=33, slots: NB [33,43), A [43,53), A1 [53,63) -> A1 pushed up by 3
	const r = at(33);
	assert.deepEqual(r.rows, ["NB", "A", "A1"]);
	assert.equal(r.shift, -3);
});

test("closed rows never stick", () => {
	const t = tree([["NB", 0], ["X", 1], ["Y", 1], ["Z", 1]]);
	assert.deepEqual(stuckRows(12, 10, 5, t.rowAt, t.row).rows, ["NB"]);
});

test("empty tree", () => {
	assert.deepEqual(stuckRows(0, 10, 5, () => null, () => null), { rows: [], shift: 0 });
});

test("rows with gaps between them (SiYuan: 28 px rows, 29 px apart)", () => {
	const t = tree([["NB", 0], ["A", 1], ["A1", 2], ["A1a", 3], ["A1b", 3], ["A1c", 3], ["A2", 2], ["B", 1]], 1);
	for (let top = 1; top < 30; top++) {
		const r = stuckRows(top, 11, 5, t.rowAt, t.row);
		assert.ok(r.rows.length >= 1 && r.rows[0] === "NB", `top=${top}: ${JSON.stringify(r.rows)}`);
	}
});
