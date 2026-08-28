import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentDurationEngine, installAgentDuration } from "../metrics/agent-duration.ts";

describe("AgentDurationEngine", () => {
	it("measures from first agent_start through agent_settled", () => {
		const clock = { value: 100 };
		const engine = new AgentDurationEngine({ now: () => clock.value });
		assert.equal(engine.start(), true);
		clock.value = 5100;
		assert.equal(engine.settle(), 5000);
		assert.deepEqual(engine.snapshot(), { lastMs: 5000, totalMs: 5000, cycles: 1 });
	});

	it("does not reset the baseline for low-level retries before settlement", () => {
		const clock = { value: 100 };
		const engine = new AgentDurationEngine({ now: () => clock.value });
		engine.start();
		clock.value = 1100;
		assert.equal(engine.start(), false);
		clock.value = 3100;
		assert.equal(engine.settle(), 3000);
	});

	it("accumulates settled cycles and ignores unmatched settlement", () => {
		const clock = { value: 0 };
		const engine = new AgentDurationEngine({ now: () => clock.value });
		assert.equal(engine.settle(), null);
		engine.start();
		clock.value = 2000;
		engine.settle();
		clock.value = 5000;
		engine.start();
		clock.value = 9000;
		engine.settle();
		assert.deepEqual(engine.snapshot(), { lastMs: 4000, totalMs: 6000, cycles: 2 });
	});

	it("drops invalid clock intervals and resets all session state", () => {
		const clock = { value: 1000 };
		const engine = new AgentDurationEngine({ now: () => clock.value });
		engine.start();
		clock.value = 900;
		assert.equal(engine.settle(), null);
		assert.deepEqual(engine.snapshot(), { lastMs: null, totalMs: 0, cycles: 0 });
		clock.value = 2000;
		engine.start();
		clock.value = 3000;
		engine.settle();
		engine.reset();
		assert.deepEqual(engine.snapshot(), { lastMs: null, totalMs: 0, cycles: 0 });
	});
});

describe("Agent duration lifecycle wiring", () => {
	it("settles cycles and resets runtime timing on shutdown", () => {
		type Handler = (event: unknown, ctx: { mode: string }) => unknown;
		const handlers = new Map<string, Handler[]>();
		const pi = {
			on(event: string, handler: Handler) {
				const registered = handlers.get(event) ?? [];
				registered.push(handler);
				handlers.set(event, registered);
			},
		} as unknown as ExtensionAPI;
		const emit = (event: string, mode = "tui") => {
			for (const handler of handlers.get(event) ?? []) handler({ type: event }, { mode });
		};
		const clock = { value: 100 };
		const engine = new AgentDurationEngine({ now: () => clock.value });
		installAgentDuration(pi, engine);

		emit("agent_start");
		clock.value = 1100;
		emit("agent_start");
		clock.value = 3100;
		emit("agent_settled");
		assert.deepEqual(engine.snapshot(), { lastMs: 3000, totalMs: 3000, cycles: 1 });

		clock.value = 5000;
		emit("agent_start");
		emit("session_shutdown");
		assert.deepEqual(engine.snapshot(), { lastMs: null, totalMs: 0, cycles: 0 });
	});

	it("ignores non-TUI lifecycle events", () => {
		type Handler = (event: unknown, ctx: { mode: string }) => unknown;
		const handlers = new Map<string, Handler[]>();
		const pi = {
			on(event: string, handler: Handler) {
				const registered = handlers.get(event) ?? [];
				registered.push(handler);
				handlers.set(event, registered);
			},
		} as unknown as ExtensionAPI;
		const engine = new AgentDurationEngine({ now: () => 1000 });
		installAgentDuration(pi, engine);
		for (const event of ["agent_start", "agent_settled"]) {
			for (const handler of handlers.get(event) ?? []) handler({ type: event }, { mode: "rpc" });
		}
		assert.deepEqual(engine.snapshot(), { lastMs: null, totalMs: 0, cycles: 0 });
	});
});