import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TokenSpeedEngine } from "../extensions/token-speed.ts";

describe("TokenSpeedEngine", () => {
	it("reports no data before any generation has been measured", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		assert.deepEqual(engine.snapshot(), { tps: null, streaming: true });
	});

	it("does not paint a character estimate when provider output is missing", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		engine.note();
		now = 1_500;
		engine.note();
		assert.equal(engine.snapshot().tps, null);
		engine.finish();
		assert.equal(engine.snapshot().tps, null);
	});

	it("measures provider output over wall-clock time from message start", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 4_000;
		engine.note({ output: 20 });
		now = 5_000;
		engine.finish({ output: 20 });
		const { tps, streaming } = engine.snapshot();
		assert.equal(streaming, false);
		assert.equal(tps, 4);
	});

	it("holds the live footer value until one second of wall clock", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		engine.note({ output: 20 });
		now = 200;
		assert.equal(engine.snapshot().tps, null);
		now = 600;
		assert.equal(engine.snapshot().tps, null);
		now = 1_000;
		const live = engine.snapshot();
		assert.equal(live.streaming, true);
		assert.equal(live.tps, 20);
	});

	it("throttles live footer updates to one second", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 1_000;
		engine.note({ output: 20 });
		const first = engine.snapshot().tps;
		assert.equal(first, 20);
		now = 1_500;
		engine.note({ output: 40 });
		assert.equal(engine.snapshot().tps, first);
		now = 2_000;
		engine.note({ output: 40 });
		assert.equal(engine.snapshot().tps, 20);
	});

	it("ignores live integer moves smaller than two", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 1_000;
		engine.note({ output: 41 });
		assert.equal(engine.snapshot().tps, 41);
		now = 2_000;
		engine.note({ output: 84 });
		assert.equal(engine.snapshot().tps, 41);
		now = 3_000;
		engine.note({ output: 129 });
		assert.equal(engine.snapshot().tps, 43);
	});

	it("does not report a burst flushed in a few milliseconds", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 10;
		engine.note({ output: 200 });
		assert.equal(engine.snapshot().tps, null);
		engine.finish({ output: 200 });
		assert.equal(engine.snapshot().tps, null);
	});

	it("keeps stalls in the denominator so they lower TPS", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 100;
		engine.note({ output: 5 });
		now = 1_200;
		engine.note({ output: 10 });
		now = 2_000;
		engine.finish({ output: 20 });
		assert.equal(engine.snapshot().tps, 10);
	});

	it("does not subtract hidden reasoning from provider output", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 1_000;
		engine.finish({ output: 500, reasoning: 480 });
		const snap = engine.snapshot();
		assert.equal(snap.tps, 500);
	});

	it("is stable across how many stream notes arrive", () => {
		function measure(noteTimes: number[]): number | null {
			let now = 0;
			const engine = new TokenSpeedEngine(() => now);
			engine.start();
			for (const time of noteTimes) {
				now = time;
				engine.note({ output: 20 });
			}
			now = 800;
			engine.finish({ output: 20 });
			return engine.snapshot().tps;
		}

		assert.equal(measure([100, 700]), 25);
		assert.equal(measure([100, 200, 300, 400, 500, 700]), 25);
	});

	it("rejects a ratio above the plausible ceiling", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 200;
		engine.finish({ output: 5_000 });
		assert.equal(engine.snapshot().tps, null);
	});

	it("keeps the last measurable value until the next generation can be measured", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 1_000;
		engine.finish({ output: 20 });
		assert.equal(engine.snapshot().tps, 20);
		now = 5_000;
		engine.start();
		assert.equal(engine.snapshot().streaming, true);
		assert.equal(engine.snapshot().tps, 20);
		now = 5_200;
		engine.note({ output: 5 });
		assert.equal(engine.snapshot().tps, 20);
		now = 6_000;
		engine.note({ output: 20 });
		assert.equal(engine.snapshot().tps, 20);
	});

	it("publishes the finished value immediately even inside the live interval", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 1_000;
		engine.note({ output: 20 });
		assert.equal(engine.snapshot().tps, 20);
		now = 1_200;
		engine.finish({ output: 36 });
		assert.equal(engine.snapshot().tps, 30);
	});

	it("clears the last value on reset", () => {
		let now = 0;
		const engine = new TokenSpeedEngine(() => now);
		engine.start();
		now = 1_000;
		engine.finish({ output: 20 });
		engine.reset();
		assert.deepEqual(engine.snapshot(), { tps: null, streaming: false });
	});
});
