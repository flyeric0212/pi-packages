import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHROME_LEFT_PAD } from "../config.ts";
import {
	ClearView,
	CLS_CHROME_ROWS,
	CLS_CUSTOM_TYPE,
	CLS_FALLBACK_TERMINAL_ROWS,
	CLS_MIN_FILL_ROWS,
	lastClearId,
	paintClear,
	sessionBranchOrEmpty,
	shouldFillViewport,
	spacerRows,
	type ClearBranchEntry,
} from "../commands/clear.ts";
import { fallbackIfStale } from "../utils.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const theme = {
	fg: (_color: string, text: string) => text,
};

function entry(id: string, type: string, customType?: string): ClearBranchEntry {
	return customType ? { id, type, customType } : { id, type };
}

describe("clear spacer height", () => {
	it("fills the viewport minus chrome, with a floor", () => {
		assert.equal(spacerRows(24), 24 - CLS_CHROME_ROWS);
		assert.equal(spacerRows(10), CLS_MIN_FILL_ROWS);
		assert.equal(spacerRows(6), CLS_MIN_FILL_ROWS);
	});

	it("treats non-finite terminal height as the fallback size", () => {
		assert.equal(spacerRows(Number.NaN), CLS_FALLBACK_TERMINAL_ROWS - CLS_CHROME_ROWS);
		assert.equal(spacerRows(Number.POSITIVE_INFINITY), CLS_FALLBACK_TERMINAL_ROWS - CLS_CHROME_ROWS);
	});
});

describe("clear fill vs marker", () => {
	it("fills only the newest clear still sitting at the branch tip", () => {
		const first = entry("c1", "custom", CLS_CUSTOM_TYPE);
		const second = entry("c2", "custom", CLS_CUSTOM_TYPE);
		const branch = [entry("m0", "message"), first, second];
		assert.equal(lastClearId(branch), "c2");
		assert.equal(shouldFillViewport("c1", branch), false);
		assert.equal(shouldFillViewport("c2", branch), true);
	});

	it("collapses after a later transcript message", () => {
		const clear = entry("c1", "custom", CLS_CUSTOM_TYPE);
		const branch = [clear, entry("m1", "message")];
		assert.equal(shouldFillViewport("c1", branch), false);
	});

	it("still fills when only non-message entries follow", () => {
		const clear = entry("c1", "custom", CLS_CUSTOM_TYPE);
		const branch = [clear, entry("t1", "thinking_level_change")];
		assert.equal(shouldFillViewport("c1", branch), true);
	});
});

describe("clear session reads during reload", () => {
	it("returns an empty branch when the session is gone", () => {
		assert.deepEqual(sessionBranchOrEmpty(undefined), []);
	});

	it("swallows Pi's stale-ctx error instead of crashing render", () => {
		assert.deepEqual(
			sessionBranchOrEmpty({
				getBranch() {
					throw new Error(
						"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx.",
					);
				},
			}),
			[],
		);
	});

	it("keeps a live branch when the session manager is still valid", () => {
		const clear = entry("c1", "custom", CLS_CUSTOM_TYPE);
		assert.deepEqual(sessionBranchOrEmpty({ getBranch: () => [clear] }), [clear]);
	});

	it("does not hide unrelated getBranch failures", () => {
		assert.throws(
			() =>
				sessionBranchOrEmpty({
					getBranch() {
						throw new Error("disk is on fire");
					},
				}),
			/disk is on fire/,
		);
	});

	it("lets header and footer renders fall back instead of exiting Pi", () => {
		assert.deepEqual(
			fallbackIfStale(() => {
				throw new Error("This extension ctx is stale after session replacement or reload.");
			}, ["ok"]),
			["ok"],
		);
		assert.equal(
			fallbackIfStale(() => "live", "ok"),
			"live",
		);
	});
});

describe("clear view leaf-id caching", () => {
	function clearBranch(): ClearBranchEntry[] {
		return [entry("c1", "custom", CLS_CUSTOM_TYPE)];
	}

	it("reuses the painted lines while the branch tip is unchanged", () => {
		let branchReads = 0;
		const view = new ClearView("c1", theme, () => ({
			getBranch: () => {
				branchReads += 1;
				return clearBranch();
			},
			getLeafId: () => "leaf-1",
		}));
		const first = view.render(40);
		const second = view.render(40);
		assert.equal(first, second);
		assert.equal(branchReads, 1);
	});

	it("recomputes after the tip moves", () => {
		let leafId: string | null = "leaf-1";
		const view = new ClearView("c1", theme, () => ({
			getBranch: () => clearBranch(),
			getLeafId: () => leafId,
		}));
		const first = view.render(40);
		leafId = "leaf-2";
		const second = view.render(40);
		assert.notEqual(first, second);
	});

	it("recomputes after a resize", () => {
		const view = new ClearView("c1", theme, () => ({
			getBranch: () => clearBranch(),
			getLeafId: () => "leaf-1",
		}));
		const first = view.render(40);
		const second = view.render(60);
		assert.notEqual(first, second);
	});
});

describe("clear painting", () => {
	it("paints a single dim rule for historical clears", () => {
		const lines = paintClear(40, { fill: false, terminalRows: 24, theme });
		assert.equal(lines.length, 1);
		assert.equal(visibleWidth(lines[0] ?? ""), 40);
		assert.ok((lines[0] ?? "").startsWith(" ".repeat(CHROME_LEFT_PAD)));
		assert.ok((lines[0] ?? "").includes("─"));
	});

	it("paints a viewport-tall block for the active clear", () => {
		const lines = paintClear(20, { fill: true, terminalRows: 24, theme });
		assert.equal(lines.length, spacerRows(24));
		assert.equal(visibleWidth(lines[0] ?? ""), 20);
		assert.ok(lines.slice(1).every((line) => line === ""));
	});

	it("never paints wider than the terminal", () => {
		for (const width of [0, 1, 8, 40]) {
			const marker = paintClear(width, { fill: false, terminalRows: 24, theme });
			const filled = paintClear(width, { fill: true, terminalRows: 12, theme });
			for (const line of [...marker, ...filled]) {
				assert.ok(visibleWidth(line) <= width);
			}
		}
	});
});
