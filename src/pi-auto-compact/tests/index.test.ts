import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piAutoCompactExtension from "../index.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown;
type CompactOptions = { customInstructions?: string };

interface Harness {
	handlers: Map<string, Handler>;
	ctx: ExtensionContext;
	compactCalls: CompactOptions[];
	notifications: Array<{ message: string; type?: string }>;
	setUsage(value: { tokens: number | null; contextWindow: number } | undefined): void;
	setIdle(value: boolean): void;
	setPending(value: boolean): void;
}

function createHarness(triggerPercent = 80): Harness {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-wire-"));
	const configFile = path.join(directory, "config.json");
	fs.writeFileSync(configFile, JSON.stringify({ autoCompact: { triggerPercent } }));

	const handlers = new Map<string, Handler>();
	const compactCalls: CompactOptions[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	let usage: { tokens: number | null; contextWindow: number } | undefined;
	let idle = true;
	let pending = false;

	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		isProjectTrusted: () => true,
		model: undefined,
		ui: { notify: (message: string, type?: string) => notifications.push({ message, type }) },
		getContextUsage: () => usage,
		isIdle: () => idle,
		hasPendingMessages: () => pending,
		compact: (options?: CompactOptions) => compactCalls.push(options ?? {}),
	} as unknown as ExtensionContext;
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
	} as unknown as ExtensionAPI;

	piAutoCompactExtension(pi, { configPaths: [configFile] });
	const start = handlers.get("session_start");
	assert.ok(start);
	start({}, ctx);

	return {
		handlers,
		ctx,
		compactCalls,
		notifications,
		setUsage(value) {
			usage = value;
		},
		setIdle(value) {
			idle = value;
		},
		setPending(value) {
			pending = value;
		},
	};
}

function emit(harness: Harness, event: string, payload: unknown = {}): unknown {
	const handler = harness.handlers.get(event);
	assert.ok(handler, `handler for ${event} must exist`);
	return handler(payload, harness.ctx);
}

function settle(harness: Harness, stopReason = "stop"): void {
	emit(harness, "agent_start");
	emit(harness, "agent_end", { messages: [{ role: "assistant", stopReason }] });
	emit(harness, "agent_settled");
}

describe("minimal native-first wiring", () => {
	it("compacts only after settlement and passes fixed quality instructions", () => {
		const harness = createHarness();
		harness.setUsage({ tokens: 240_000, contextWindow: 272_000 });

		emit(harness, "agent_start");
		emit(harness, "agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
		assert.equal(harness.compactCalls.length, 0);
		emit(harness, "agent_settled");

		assert.equal(harness.compactCalls.length, 1);
		const instructions = harness.compactCalls[0]!.customInstructions ?? "";
		assert.ok(instructions.includes("unfinished work with exact file paths"));
		assert.ok(instructions.includes("<read-files>/<modified-files>"));
	});

	it("honors the configured model-relative percentage", () => {
		const harness = createHarness(90);
		harness.setUsage({ tokens: 240_000, contextWindow: 272_000 }); // 88.2%
		settle(harness);
		assert.equal(harness.compactCalls.length, 0);

		harness.setUsage({ tokens: 250_000, contextWindow: 272_000 }); // 91.9%
		settle(harness);
		assert.equal(harness.compactCalls.length, 1);
	});

	it("skips aborted, failed, truncated, and missing assistant outcomes", () => {
		for (const reason of ["aborted", "error", "length"]) {
			const harness = createHarness();
			harness.setUsage({ tokens: 240_000, contextWindow: 272_000 });
			settle(harness, reason);
			assert.equal(harness.compactCalls.length, 0, reason);
		}

		const missing = createHarness();
		missing.setUsage({ tokens: 240_000, contextWindow: 272_000 });
		emit(missing, "agent_start");
		emit(missing, "agent_end", { messages: [] });
		emit(missing, "agent_settled");
		assert.equal(missing.compactCalls.length, 0);
	});

	it("rechecks idle, pending messages, and known usage", () => {
		const busy = createHarness();
		busy.setUsage({ tokens: 240_000, contextWindow: 272_000 });
		busy.setIdle(false);
		settle(busy);
		assert.equal(busy.compactCalls.length, 0);

		const pending = createHarness();
		pending.setUsage({ tokens: 240_000, contextWindow: 272_000 });
		pending.setPending(true);
		settle(pending);
		assert.equal(pending.compactCalls.length, 0);

		const unknown = createHarness();
		unknown.setUsage({ tokens: null, contextWindow: 272_000 });
		settle(unknown);
		assert.equal(unknown.compactCalls.length, 0);
	});

	it("blocks duplicate requests until the official success event", () => {
		const harness = createHarness();
		harness.setUsage({ tokens: 240_000, contextWindow: 272_000 });
		settle(harness);
		settle(harness);
		assert.equal(harness.compactCalls.length, 1);

		emit(harness, "session_compact", { reason: "manual" });
		settle(harness);
		assert.equal(harness.compactCalls.length, 2);
	});

	it("disables extension attempts after its first failure", () => {
		const harness = createHarness();
		harness.setUsage({ tokens: 240_000, contextWindow: 272_000 });
		settle(harness);

		// An unrelated native failure must not be attributed to this request.
		emit(harness, "session_compact_failed", {
			reason: "threshold",
			errorMessage: "native",
			aborted: false,
		});
		assert.equal(harness.notifications.length, 0);

		emit(harness, "session_compact_failed", {
			reason: "manual",
			errorMessage: "boom",
			aborted: false,
		});
		assert.ok(harness.notifications.some((notice) => notice.type === "error" && notice.message.includes("boom")));
		settle(harness);
		assert.equal(harness.compactCalls.length, 1);
	});

	it("does not register old mid-run or threshold interception hooks", () => {
		const harness = createHarness();
		assert.equal(harness.handlers.has("message_end"), false);
		assert.equal(harness.handlers.has("session_before_compact"), false);
		assert.equal(harness.handlers.has("model_select"), false);
		assert.equal(harness.handlers.has("session_tree"), false);
	});
});
