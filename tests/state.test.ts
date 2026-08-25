import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createState, CraftStore, sameCraftState } from "../extensions/state.ts";
import { internLines, sameLines } from "../extensions/utils.ts";

describe("CraftStore", () => {
	it("does not notify when the displayed snapshot is unchanged", () => {
		const store = new CraftStore({ cwd: "/tmp", version: "1" });
		let renders = 0;
		store.subscribe(() => {
			renders += 1;
		});
		assert.equal(store.patch({ cwd: "/tmp" }), false);
		assert.equal(renders, 0);
		assert.equal(store.patch({ cwd: "/work" }), true);
		assert.equal(renders, 1);
	});

	it("treats rounded tok/s as the same displayed value", () => {
		const a = createState({
			cwd: "/tmp",
			version: "1",
			responding: true,
			tps: { tps: 41.2, estimated: true, streaming: true },
		});
		const b = createState({
			cwd: "/tmp",
			version: "1",
			responding: true,
			tps: { tps: 41.4, estimated: false, streaming: true },
		});
		assert.equal(sameCraftState(a, b), true);
		assert.equal(
			sameCraftState(a, createState({ ...b, tps: { tps: 42, estimated: false, streaming: true } })),
			false,
		);
	});
});

describe("render intern", () => {
	it("returns the previous array when the rows match", () => {
		const cache: { lines?: string[] } = {};
		const first = internLines(cache, ["a", "b"]);
		const second = internLines(cache, ["a", "b"]);
		assert.equal(second, first);
		assert.equal(sameLines(first, ["a", "b"]), true);
		const third = internLines(cache, ["a", "c"]);
		assert.notEqual(third, first);
	});
});
