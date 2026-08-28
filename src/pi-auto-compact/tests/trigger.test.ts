import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_AUTO_COMPACT_CONFIG } from "../config.ts";
import {
	createSessionState,
	markNotify,
	markTriggered,
	onCompactionComplete,
	onCompactionError,
	onRearmed,
	MAX_CONSECUTIVE_FAILURES,
} from "../state.ts";
import { computeRealTotal, evaluateTrigger, type TriggerUsage } from "../trigger.ts";

const WINDOW = 272_000;
const CONFIG = DEFAULT_AUTO_COMPACT_CONFIG;

function usage(tokens: number, percent: number): TriggerUsage {
	return { tokens, contextWindow: WINDOW, percent };
}

function evaluate(tokens: number, percent: number, state = createSessionState()) {
	return evaluateTrigger({ config: CONFIG, state, usage: usage(tokens, percent) });
}

describe("computeRealTotal", () => {
	it("prefers totalTokens and otherwise sums prompt, cache, and output", () => {
		assert.equal(computeRealTotal({ totalTokens: 225_000, input: 1 }), 225_000);
		assert.equal(computeRealTotal({ input: 1000, output: 15_000, cacheRead: 200_000, cacheWrite: 0 }), 216_000);
		assert.equal(computeRealTotal({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }), 10);
	});

	it("returns null for missing, invalid, or all-zero usage", () => {
		assert.equal(computeRealTotal(undefined), null);
		assert.equal(computeRealTotal(null), null);
		assert.equal(computeRealTotal({}), null);
		assert.equal(computeRealTotal({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), null);
		assert.equal(computeRealTotal({ totalTokens: Number.NaN }), null);
	});
});

describe("evaluateTrigger", () => {
	it("never triggers when disabled by config or session", () => {
		const disabled = { ...CONFIG, autoCompact: { ...CONFIG.autoCompact, enabled: false } };
		assert.equal(
			evaluateTrigger({ config: disabled, state: createSessionState(), usage: usage(300_000, 110) }).gate,
			"config-disabled",
		);
		assert.equal(
			evaluateTrigger({
				config: CONFIG,
				state: { ...createSessionState(), disabled: true },
				usage: usage(300_000, 110),
			}).gate,
			"session-disabled",
		);
	});

	it("skips when usage is missing or unknown", () => {
		assert.equal(evaluateTrigger({ config: CONFIG, state: createSessionState(), usage: undefined }).gate, "no-usage");
		assert.equal(
			evaluateTrigger({
				config: CONFIG,
				state: createSessionState(),
				usage: { tokens: null, contextWindow: WINDOW, percent: null },
			}).gate,
			"no-usage",
		);
		// Zero usage is valid data, just below the threshold.
		assert.equal(evaluate(0, 0).gate, "below-percent");
	});

	it("skips while a compaction is in flight", () => {
		const state = { ...createSessionState(), compacting: true };
		assert.equal(evaluate(300_000, 110, state).gate, "compacting");
	});

	it("triggers only above the configured percentage", () => {
		assert.equal(evaluate(217_600, 80).action, "compact");
		assert.equal(evaluate(217_599, 79.99).gate, "below-percent");
		assert.equal(evaluate(100_000, 36.8).gate, "below-percent");
	});

	it("uses the real total when known, not the stale estimate", () => {
		// Pi's estimate says 50%, but the real total (incl. cache) is 240k = 88%.
		const state = { ...createSessionState(), realTotal: 240_000 };
		const decision = evaluateTrigger({ config: CONFIG, state, usage: usage(136_000, 50) });
		assert.equal(decision.action, "compact");
		assert.ok(decision.realPct !== null && Math.abs(decision.realPct - 88.24) < 0.1);
	});

	it("enforces the debounce growth guard even when tokens decreased but remain above threshold", () => {
		const state = { ...createSessionState(), lastCompactTokens: 240_000 };
		assert.equal(evaluate(230_000, 84.5, state).gate, "debounce");
		assert.equal(evaluate(250_000, 91.9, state).gate, "debounce");
		assert.equal(evaluate(260_000, 95.6, state).action, "compact");
	});

	it("disarms after a failure until context drops below the threshold", () => {
		const failed = { ...createSessionState(), failed: true };
		assert.equal(evaluate(300_000, 110, failed).gate, "disarmed");
		const below = evaluate(200_000, 73.5, failed);
		assert.equal(below.gate, "rearmed");
		assert.equal(below.action, "none");
	});

	it("notifies instead of compacting in notifyOnly mode", () => {
		const notifyOnly = { ...CONFIG, autoCompact: { ...CONFIG.autoCompact, notifyOnly: true } };
		const decision = evaluateTrigger({
			config: notifyOnly,
			state: createSessionState(),
			usage: usage(240_000, 88.2),
		});
		assert.equal(decision.action, "notify");
		assert.equal(decision.gate, "ok");
	});
});

describe("session state transitions", () => {
	it("markTriggered records the debounce baseline and blocks re-entry", () => {
		const state = markTriggered(createSessionState(), 240_000);
		assert.equal(state.compacting, true);
		assert.equal(state.lastCompactTokens, 240_000);
	});

	it("markNotify records the baseline without compacting", () => {
		const state = markNotify(createSessionState(), 240_000);
		assert.equal(state.compacting, false);
		assert.equal(state.lastCompactTokens, 240_000);
	});

	it("onCompactionComplete clears in-flight state and resets failures", () => {
		const state = onCompactionComplete({ ...createSessionState(), compacting: true, consecutiveFailures: 2, realTotal: 240_000 });
		assert.deepEqual(state, createSessionState());
	});

	it("onCompactionError disarms, counts failures, disables at the max", () => {
		let state = createSessionState();
		for (let i = 1; i <= MAX_CONSECUTIVE_FAILURES; i++) {
			state = onCompactionError(state);
			assert.equal(state.failed, true);
			assert.equal(state.consecutiveFailures, i);
		}
		assert.equal(state.disabled, true);
		// Successful compaction later resets the counter.
		const recovered = onCompactionComplete(onRearmed(state));
		assert.equal(recovered.consecutiveFailures, 0);
		assert.equal(recovered.disabled, true); // disabled is sticky for the session
	});

	it("onRearmed re-arms and resets debounce after the context dropped below the threshold", () => {
		const state = onRearmed({ ...createSessionState(), failed: true, lastCompactTokens: 240_000 });
		assert.equal(state.failed, false);
		assert.equal(state.lastCompactTokens, 0);
	});
});