import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piAutoCompactExtension from "../index.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

interface Harness {
	pi: ExtensionAPI;
	handlers: Map<string, Handler>;
	ctx: ExtensionContext;
	sendUserMessageCalls: string[];
	notifications: Array<{ message: string; type?: string }>;
	get compactOptions(): { customInstructions?: string; onComplete?: () => void; onError?: (err: Error) => void } | null;
	set compactOptions(value: { customInstructions?: string; onComplete?: () => void; onError?: (err: Error) => void } | null);
	setUsage(usage: { tokens: number; contextWindow: number; percent: number } | undefined): void;
	set hasPendingMessages(value: boolean);
	file: string;
}

function writeConfig(dir: string, config: Record<string, unknown>): string {
	const file = path.join(dir, "config.json");
	fs.writeFileSync(file, JSON.stringify(config));
	return file;
}

function createHarness(config: Record<string, unknown> = {}): Harness {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-wire-"));
	const file = writeConfig(dir, config);

	const handlers = new Map<string, Handler>();
	const sendUserMessageCalls: string[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const compactState: {
		options: { customInstructions?: string; onComplete?: () => void; onError?: (err: Error) => void } | null;
	} = { options: null };

	let usage: { tokens: number; contextWindow: number; percent: number } | undefined = undefined;
	let hasPending = false;

	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		isProjectTrusted: () => true,
		model: undefined,
		ui: {
			notify: (message: string, type?: string) => {
				notifications.push({ message, type });
			},
		},
		getContextUsage: () => usage,
		hasPendingMessages: () => hasPending,
		compact: (options: Harness["compactOptions"]) => {
			compactState.options = options;
		},
	} as unknown as ExtensionContext;

	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
		},
		sendUserMessage: (content: string) => {
			sendUserMessageCalls.push(content);
		},
	} as unknown as ExtensionAPI;

	piAutoCompactExtension(pi, { configPaths: [file] });

	// Spin up the session (creates the config loader).
	const sessionStart = handlers.get("session_start");
	assert.ok(sessionStart, "session_start handler must be registered");
	sessionStart({}, ctx);

	return {
		pi,
		handlers,
		ctx,
		sendUserMessageCalls,
		notifications,
		get compactOptions() {
			return compactState.options;
		},
		set compactOptions(value) {
			compactState.options = value;
		},
		setUsage(u) {
			usage = u;
		},
		set hasPendingMessages(value: boolean) {
			hasPending = value;
		},
		file,
	};
}

function assistantMessage(
	stopReason: string,
	usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number },
) {
	return { role: "assistant", stopReason, usage };
}

function emit(h: Harness, event: string, payload: unknown): void {
	const handler = h.handlers.get(event);
	assert.ok(handler, `handler for ${event} must exist`);
	handler(payload, h.ctx);
}

describe("extension wiring", () => {
	it("compacts at the threshold and resumes via sendUserMessage", () => {
		const h = createHarness();
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });

		emit(h, "message_end", { message: assistantMessage("stop", { input: 1000, cacheRead: 239_000, cacheWrite: 0 }) });

		assert.ok(h.compactOptions, "ctx.compact must be called");
		assert.ok(h.compactOptions!.customInstructions!.includes("Focus the summary on"));

		h.compactOptions!.onComplete!();
		assert.equal(h.sendUserMessageCalls.length, 1);
		assert.ok(h.sendUserMessageCalls[0]!.includes("自动压缩"));
	});

	it("counts assistant output when the prompt alone is below the threshold", () => {
		const h = createHarness();
		h.setUsage({ tokens: 225_000, contextWindow: 272_000, percent: 82.7 });

		emit(h, "message_end", {
			message: assistantMessage("stop", { input: 210_000, output: 15_000, cacheRead: 0, cacheWrite: 0 }),
		});

		assert.ok(h.compactOptions, "input + output must trigger above the threshold");
	});

	it("passes customInstructions through", () => {
		const h = createHarness({ autoCompact: { customInstructions: "CUSTOM-INSTR" } });
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.equal(h.compactOptions!.customInstructions, "CUSTOM-INSTR");
	});

	it("never triggers for aborted, error, or length messages", () => {
		const h = createHarness();
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("aborted") });
		emit(h, "message_end", { message: assistantMessage("error") });
		emit(h, "message_end", { message: assistantMessage("length", { totalTokens: 240_000 }) });
		assert.equal(h.compactOptions, null);
		assert.equal(h.sendUserMessageCalls.length, 0);
	});

	it("interruptTurn=false triggers on agent_end only, not mid-turn", () => {
		const h = createHarness({ autoCompact: { interruptTurn: false } });
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });

		// Mid-turn message with a tool call must NOT trigger.
		emit(h, "message_end", { message: assistantMessage("toolUse", { input: 1000, cacheRead: 239_000 }) });
		assert.equal(h.compactOptions, null);

		// Turn boundary: agent_end with a completed assistant message triggers.
		emit(h, "agent_end", { messages: [assistantMessage("stop", { input: 1000, cacheRead: 239_000 })] });
		assert.ok(h.compactOptions, "agent_end must trigger compaction");
		assert.ok(h.notifications.some((n) => n.message.includes("自动压缩中")));
	});

	it("interruptTurn=false skips aborted and length agent_end messages", () => {
		const h = createHarness({ autoCompact: { interruptTurn: false } });
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "agent_end", { messages: [assistantMessage("aborted")] });
		emit(h, "agent_end", { messages: [assistantMessage("length", { totalTokens: 240_000 })] });
		assert.equal(h.compactOptions, null);
	});

	it("notifyOnly notifies without compacting or resuming", () => {
		const h = createHarness({ autoCompact: { notifyOnly: true } });
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });

		assert.equal(h.compactOptions, null);
		assert.equal(h.sendUserMessageCalls.length, 0);
		assert.ok(h.notifications.some((n) => n.type === "warning" && n.message.includes("/compact")));
	});

	it("notifyOnly debounce suppresses a lower token point that remains above threshold", () => {
		const h = createHarness({ autoCompact: { notifyOnly: true } });
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { totalTokens: 240_000 }) });
		const notificationCount = h.notifications.length;

		h.setUsage({ tokens: 230_000, contextWindow: 272_000, percent: 84.5 });
		emit(h, "message_end", { message: assistantMessage("stop", { totalTokens: 230_000 }) });

		assert.equal(h.notifications.length, notificationCount, "token decrease must not bypass notify debounce");
	});

	it("cancels native threshold compaction only while ours is in flight", () => {
		const h = createHarness();
		const beforeCompact = h.handlers.get("session_before_compact")!;

		// Not compacting: pi's native threshold stays as the safety net.
		assert.equal(beforeCompact({ reason: "threshold" }, h.ctx), undefined);
		assert.equal(beforeCompact({ reason: "manual" }, h.ctx), undefined);
		assert.equal(beforeCompact({ reason: "overflow" }, h.ctx), undefined);

		// Mid-compaction: cancel pi's threshold to prevent a double compaction.
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.compactOptions, "auto-compact must be in flight");
		assert.deepEqual(beforeCompact({ reason: "threshold" }, h.ctx), { cancel: true });
		assert.equal(beforeCompact({ reason: "manual" }, h.ctx), undefined);
		assert.equal(beforeCompact({ reason: "overflow" }, h.ctx), undefined);
	});

	it("keeps native threshold compaction as the safety net in degraded states", () => {
		// notifyOnly never compacts itself; pi's threshold must stay enabled.
		const notifyOnly = createHarness({ autoCompact: { notifyOnly: true } });
		const beforeCompactNotify = notifyOnly.handlers.get("session_before_compact")!;
		assert.equal(beforeCompactNotify({ reason: "threshold" }, notifyOnly.ctx), undefined);

		// Disarmed after a failure: native threshold may still rescue the session.
		const h = createHarness();
		const beforeCompact = h.handlers.get("session_before_compact")!;
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.compactOptions);
		h.compactOptions!.onError!(new Error("boom"));
		assert.equal(beforeCompact({ reason: "threshold" }, h.ctx), undefined);

		// Three failures (with re-arming dips below the threshold) disable the
		// session; pi's native threshold stays enabled the whole time.
		const attempt = (expectTrigger: boolean): void => {
			// Re-arm first: after each failure the plugin waits until context
			// drops back below the threshold.
			h.setUsage({ tokens: 20_000, contextWindow: 272_000, percent: 7.3 });
			emit(h, "message_end", { message: assistantMessage("toolUse", { input: 20_000 }) });
			const before = h.compactOptions;
			h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
			emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
			if (expectTrigger) {
				assert.notEqual(h.compactOptions, before, "must trigger while not yet disabled");
				h.compactOptions!.onError!(new Error("boom"));
			} else {
				assert.equal(h.compactOptions, before, "disabled: no more attempts");
			}
		};
		attempt(true); // failure 2
		attempt(true); // failure 3 -> session disabled
		attempt(false); // disabled: no further attempts
		assert.equal(beforeCompact({ reason: "threshold" }, h.ctx), undefined);
	});

	it("compacting flag prevents duplicate triggers; re-triggers only after growth", () => {
		const h = createHarness();
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.compactOptions, "first trigger");

		// In-flight compaction: another message must not retrigger.
		h.setUsage({ tokens: 250_000, contextWindow: 272_000, percent: 92 });
		emit(h, "message_end", { message: assistantMessage("toolUse", { input: 250_000 }) });
		const callsAfterSecond = JSON.stringify(h.compactOptions);

		h.compactOptions!.onComplete!();
		// After completion: same region does not retrigger (debounce), growth does.
		h.setUsage({ tokens: 245_000, contextWindow: 272_000, percent: 90 });
		emit(h, "message_end", { message: assistantMessage("toolUse", { input: 245_000 }) });
		assert.equal(JSON.stringify(h.compactOptions), callsAfterSecond, "no retrigger without growth");

		h.setUsage({ tokens: 300_000, contextWindow: 272_000, percent: 110 });
		emit(h, "message_end", { message: assistantMessage("toolUse", { input: 300_000 }) });
		// 300k - 240k = 60k >= debounce 20k and >= 80% -> second trigger.
		assert.equal(h.sendUserMessageCalls.length, 1, "resume only after first completion");
	});

	it("disarms after failure until context drops below the threshold", () => {
		const h = createHarness();
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.compactOptions);

		h.compactOptions!.onError!(new Error("boom"));
		assert.ok(h.notifications.some((n) => n.type === "error" && n.message.includes("boom")));

		// Disarmed: still over threshold -> no attempt.
		h.compactOptions = null;
		h.setUsage({ tokens: 260_000, contextWindow: 272_000, percent: 95 });
		emit(h, "message_end", { message: assistantMessage("toolUse", { input: 260_000 }) });
		assert.equal(h.compactOptions, null, "disarmed while above threshold");

		// Drop below threshold -> rearmed, then retrigger on growth.
		h.setUsage({ tokens: 180_000, contextWindow: 272_000, percent: 66 });
		emit(h, "message_end", { message: assistantMessage("toolUse", { input: 180_000 }) });
		h.setUsage({ tokens: 280_000, contextWindow: 272_000, percent: 103 });
		emit(h, "message_end", { message: assistantMessage("toolUse", { input: 280_000 }) });
		assert.ok(h.compactOptions, "re-armed after dropping below the threshold");
	});

	it("uses English copy when lang=en", () => {
		const h = createHarness({ autoCompact: { lang: "en" } });
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.notifications.some((n) => n.message.includes("compacting")));
		h.compactOptions!.onComplete!();
		assert.ok(h.sendUserMessageCalls[0]!.includes("auto-compacted"));
	});

	it("skips the resume prompt when input is already pending", () => {
		const h = createHarness();
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.compactOptions);

		h.hasPendingMessages = true;
		h.compactOptions!.onComplete!();
		assert.equal(h.sendUserMessageCalls.length, 0, "no resume prompt on top of pending input");

		// State still resets: a later compaction resumes normally.
		h.hasPendingMessages = false;
		const before = h.compactOptions;
		h.setUsage({ tokens: 300_000, contextWindow: 272_000, percent: 110 });
		emit(h, "message_end", { message: assistantMessage("toolUse", { input: 300_000 }) });
		const secondCompact = h.compactOptions;
		assert.notEqual(secondCompact, before, "still triggers after pending-input compaction");
		secondCompact!.onComplete!();
		assert.equal(h.sendUserMessageCalls.length, 1, "resume prompt sent when nothing is pending");
	});

	it("resets on completed tree navigation and shutdown, not cancellable before-switch hooks", () => {
		const h = createHarness();
		assert.equal(h.handlers.has("session_before_switch"), false);
		assert.equal(h.handlers.has("session_before_fork"), false);

		emit(h, "session_tree", { newLeafId: "x", oldLeafId: "y" });
		emit(h, "model_select", { model: {}, previousModel: undefined, source: "set" });
		// Extension stays functional afterwards.
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { totalTokens: 240_000 }) });
		assert.ok(h.compactOptions);
		h.compactOptions!.onComplete!();
		h.compactOptions = null;
		emit(h, "session_shutdown", {});
	});

	it("resets debounce baseline across multiple compaction cycles", () => {
		const h = createHarness();
		// Cycle 1: triggers at 240k (88%)
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.compactOptions, "cycle 1 must trigger compaction");

		// Compaction completes and drops context to 20k (< 80%)
		h.compactOptions!.onComplete!();
		h.compactOptions = null;
		h.setUsage({ tokens: 20_000, contextWindow: 272_000, percent: 7.3 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 20_000 }) });
		assert.equal(h.compactOptions, null, "below threshold does not trigger");

		// Cycle 2: context grows back to 220k (80.8% >= 80%), must trigger again immediately!
		h.setUsage({ tokens: 220_000, contextWindow: 272_000, percent: 80.8 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 220_000 }) });
		assert.ok(h.compactOptions, "cycle 2 must trigger compaction at threshold without high-watermark trap");
	});

	it("manual session_compact resets failure and debounce state", () => {
		const h = createHarness();
		// Force consecutive failures to disable auto-compaction
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.compactOptions);
		h.compactOptions!.onError!(new Error("fail 1"));
		h.compactOptions = null;

		// Manual /compact succeeds
		emit(h, "session_compact", { reason: "manual", fromExtension: false });

		// Context drops and grows again -> auto-compaction should work
		h.setUsage({ tokens: 20_000, contextWindow: 272_000, percent: 7.3 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 20_000 }) });
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "message_end", { message: assistantMessage("stop", { input: 240_000 }) });
		assert.ok(h.compactOptions, "re-arms and triggers after manual compaction");
	});

	it("agent_end ignores runs with no assistant message", () => {
		const h = createHarness({ autoCompact: { interruptTurn: false } });
		h.setUsage({ tokens: 240_000, contextWindow: 272_000, percent: 88 });
		emit(h, "agent_end", { messages: [] });
		assert.equal(h.compactOptions, null);
	});
});