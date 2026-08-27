import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	computeSessionStats,
	EMPTY_STATS,
	formatCostTotal,
	formatDuration,
	formatReasoningShare,
	formatStatsLines,
	formatStops,
	formatToolBreakdown,
	paintStatsView,
	type SessionStats,
	type StatsEntry,
} from "../commands/stats.ts";
import { cumulativeCacheHitRate } from "../utils.ts";

function assistantEntry(overrides: {
	usage?: Record<string, unknown>;
	content?: unknown;
	timestamp?: string;
	stopReason?: string;
}): StatsEntry {
	type StatsUsage = NonNullable<NonNullable<StatsEntry["message"]>["usage"]>;
	return {
		type: "message",
		timestamp: overrides.timestamp,
		message: {
			role: "assistant",
			usage: overrides.usage as StatsUsage,
			content: overrides.content ?? [{ type: "text", text: "ok" }],
			stopReason: overrides.stopReason,
		},
	};
}

function toolResultEntry(overrides: { toolName?: string; isError?: boolean; timestamp?: string }): StatsEntry {
	return {
		type: "message",
		timestamp: overrides.timestamp,
		message: { role: "toolResult", toolName: overrides.toolName, isError: overrides.isError },
	};
}

describe("computeSessionStats", () => {
	it("sums the four token buckets and keeps Σ self-consistent", () => {
		const stats = computeSessionStats([
			assistantEntry({ usage: { input: 100, output: 40, cacheRead: 900, cacheWrite: 20 } }),
			assistantEntry({ usage: { input: 50, output: 60, cacheRead: 800, cacheWrite: 10 } }),
			{ type: "compaction", timestamp: new Date().toISOString() },
		]);
		assert.equal(stats.input, 150);
		assert.equal(stats.output, 100);
		assert.equal(stats.cacheRead, 1700);
		assert.equal(stats.cacheWrite, 30);
		assert.equal(stats.total, 150 + 100 + 1700 + 30);
	});

	it("counts prompts, responses, and toolCall blocks only on assistant messages", () => {
		const stats = computeSessionStats([
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
			assistantEntry({
				content: [
					{ type: "thinking", thinking: "hmm" },
					{ type: "toolCall", name: "bash", arguments: { command: "ls" } },
					{ type: "toolCall", name: "read", arguments: { path: "a.ts" } },
				],
			}),
			{ type: "message", message: { role: "toolResult", content: [] } },
		]);
		assert.equal(stats.prompts, 1);
		assert.equal(stats.responses, 1);
		assert.equal(stats.toolCalls, 2);
	});

	it("excludes toolResult usage from the v1 billing scope", () => {
		const stats = computeSessionStats([
			assistantEntry({ usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } }),
			{
				type: "message",
				message: { role: "toolResult", usage: { input: 999, output: 999, cacheRead: 999, cacheWrite: 999 } },
			},
		]);
		assert.equal(stats.total, 15);
	});

	it("derives the cache hit rate exactly like the footer does", () => {
		const entries = [
			assistantEntry({ usage: { input: 10, output: 5, cacheRead: 85, cacheWrite: 5 } }),
			assistantEntry({ usage: { input: 20, output: 8, cacheRead: 120, cacheWrite: 2 } }),
		];
		const stats = computeSessionStats(entries);
		assert.equal(
			stats.cacheHitPercent,
			cumulativeCacheHitRate(entries.flatMap((entry) => (entry.message?.usage ? [entry.message.usage] : []))),
		);
	});

	it("measures duration from first to last parseable timestamp and rejects inversions", () => {
		const t = (iso: string): StatsEntry => ({ type: "message", timestamp: iso, message: { role: "user" } });
		const spanned = computeSessionStats([
			t("2026-08-26T01:00:00Z"),
			assistantEntry({ timestamp: "2026-08-26T02:30:00Z" }),
		]);
		assert.equal(spanned.durationMs, 90 * 60_000);

		assert.equal(computeSessionStats([t("2026-08-26T01:00:00Z")]).durationMs, 0); // real span of a lone entry
		assert.equal(computeSessionStats([t("not-a-date"), t("also-bad")]).durationMs, null);
		const inverted = computeSessionStats([
			t("2026-08-26T02:00:00Z"),
			t("2026-08-26T01:00:00Z"),
		]);
		assert.equal(inverted.durationMs, null);
	});

	it("returns the empty snapshot for a fresh branch", () => {
		assert.deepEqual(computeSessionStats([]), EMPTY_STATS);
	});
});

describe("enriched facts", () => {
	it("sums provider-reported cost and stays null until one finite report", () => {
		const priced = computeSessionStats([
			assistantEntry({ usage: { input: 1, output: 1, cost: { total: 0.5 } } }),
			assistantEntry({ usage: { input: 1, output: 1, cost: { total: 0.25 } } }),
		]);
		assert.equal(priced.costTotal, 0.75);

		assert.equal(computeSessionStats([assistantEntry({ usage: { input: 1, output: 1 } })]).costTotal, null);
		// Non-finite reports never seed the accumulator.
		assert.equal(
			computeSessionStats([assistantEntry({ usage: { input: 1, cost: { total: Number.NaN } } })]).costTotal,
			null,
		);
	});

	it("sums reasoning tokens only when a provider reported them", () => {
		const reasoned = computeSessionStats([
			assistantEntry({ usage: { input: 1, output: 100, reasoning: 30 } }),
			assistantEntry({ usage: { input: 1, output: 50, reasoning: 20 } }),
		]);
		assert.equal(reasoned.reasoning, 50);

		assert.equal(computeSessionStats([assistantEntry({ usage: { input: 1, output: 10 } })]).reasoning, null);
	});

	it("counts only abnormal stop reasons, ignoring stop/toolUse/pending", () => {
		const stats = computeSessionStats([
			assistantEntry({ stopReason: "stop" }),
			assistantEntry({ stopReason: "toolUse" }),
			assistantEntry({ stopReason: "aborted" }),
			assistantEntry({ stopReason: "length" }),
			assistantEntry({ stopReason: "error" }),
		]);
		assert.deepEqual(stats.stops, { aborted: 1, length: 1, error: 1 });
		assert.equal(stats.responses, 5);
		assert.deepEqual(computeSessionStats([assistantEntry({ stopReason: "stop" })]).stops, {
			aborted: 0,
			length: 0,
			error: 0,
		});
	});

	it("ranks tool calls per name and buckets toolResult failures per tool", () => {
		const calls = [
			{ type: "toolCall", name: "read", arguments: {} },
			{ type: "toolCall", name: "bash", arguments: {} },
			{ type: "toolCall", name: "read", arguments: {} },
			{ type: "toolCall", name: "edit", arguments: {} },
			{ type: "toolCall", name: "grep", arguments: {} },
			{ type: "toolCall", name: "glob", arguments: {} },
		];
		const stats = computeSessionStats([
			assistantEntry({ content: calls }),
			{ type: "message", message: { role: "toolResult", toolName: "bash", isError: true, usage: { input: 999 } } },
			{ type: "message", message: { role: "toolResult", toolName: "bash", isError: true } },
			{ type: "message", message: { role: "toolResult", toolName: "read", isError: true } },
		]);
		assert.equal(stats.toolCalls, 6);
		// toolResult usage never enters the token scope.
		assert.equal(stats.total, 0);
		assert.deepEqual(Object.keys(stats.toolCounts), ["read", "bash", "edit", "grep", "glob"]);
		assert.deepEqual(stats.toolFails, { bash: 2, read: 1 });
	});
});

describe("formatDuration", () => {
	it("buckets into h/m/s without trailing zeros", () => {
		assert.equal(formatDuration(59_000), "59s");
		assert.equal(formatDuration(61_000), "1m 1s");
		assert.equal(formatDuration(3 * 3600_000 + 2 * 60_000), "3h 2m");
		assert.equal(formatDuration(-5), "0s");
	});
});

describe("row formatters", () => {
	it("formats cost with adaptive precision and hides absence", () => {
		assert.equal(formatCostTotal(null), undefined);
		assert.equal(formatCostTotal(Number.NaN), undefined);
		assert.equal(formatCostTotal(0), "$0.00"); // free/local models stay visible
		assert.equal(formatCostTotal(3.418), "$3.42");
		assert.equal(formatCostTotal(0.00123), "$0.0012");
	});

	it("shares reasoning of output and hides zero or unreported values", () => {
		assert.equal(formatReasoningShare(null, 100), undefined);
		assert.equal(formatReasoningShare(0, 100), undefined);
		assert.equal(formatReasoningShare(8200, 45_600), "8.2k (18% of output)");
		assert.equal(formatReasoningShare(500, 0), "500");
	});

	it("ranks, folds, and flags the tools row; hides it when nothing ran", () => {
		assert.equal(formatToolBreakdown(0, undefined, {}), undefined);
		// Legacy snapshots may carry toolCalls without a name breakdown.
		assert.equal(formatToolBreakdown(4, undefined, undefined), undefined);
		assert.equal(
			formatToolBreakdown(6, { read: 1, bash: 1 }, { read: 2, bash: 1, edit: 1, grep: 1, glob: 1 }),
			"read 2 (1) · bash 1 (1) · edit 1 · grep 1 · glob 1",
		);
		// Failure without a recorded call still surfaces (compaction boundary).
		assert.equal(formatToolBreakdown(0, { read: 1 }, {}), "read (1)");
	});

	it("lists every built-in kind without folding, folding only past the runaway cap", () => {
		const builtins = { read: 9, bash: 8, edit: 7, write: 6, grep: 5, find: 4, ls: 3 };
		assert.equal(
			formatToolBreakdown(42, undefined, builtins),
			"read 9 · bash 8 · edit 7 · write 6 · grep 5 · find 4 · ls 3",
		);
		const many: Record<string, number> = {};
		for (let i = 0; i < 14; i++) many[`tool${i}`] = 14 - i;
		const folded = formatToolBreakdown(100, undefined, many)!;
		assert.match(folded, /· \+2 kinds$/);
		assert.equal(folded.split(" · ").length, 13); // 12 names + fold marker
	});

	it("lists only non-zero abnormal endings", () => {
		assert.equal(formatStops(undefined), undefined);
		assert.equal(formatStops({ aborted: 0, length: 0, error: 0 }), undefined);
		assert.equal(formatStops({ aborted: 3, length: 0, error: 1 }), "3 aborted · 1 error");
	});
});

describe("formatStatsLines", () => {
	describe("alignment", () => {
		it("aligns labels and hides absent facts instead of dashing them", () => {
			const lines = formatStatsLines(computeSessionStats([
				assistantEntry({ usage: { input: 12_300, output: 45_600 } }),
				{ type: "message", timestamp: "2026-08-26T01:00:00Z", message: { role: "user" } },
				assistantEntry({ timestamp: "2026-08-26T01:30:00Z" }),
			]));
			assert.equal(lines.length, 3);
			assert.match(lines[0]!, /^tokens:\s+↑12k ↓46k R0 W0 · Σ58k$/);
			assert.ok(!lines.some((line) => line.startsWith("cache"))); // no cache read yet
			assert.match(lines[2]!, /^time:\s+30m 0s$/);
		});

		it("shows the cache row once a read exists, keeping Σ over all four buckets", () => {
			const lines = formatStatsLines(computeSessionStats([
				assistantEntry({ usage: { input: 12_300, output: 45_600, cacheRead: 230_000, cacheWrite: 1_200 } }),
			]));
			assert.match(lines[1]!, /^cache:\s+CH[\d.]+%$/);
			assert.match(lines[0]!, /Σ289k$/); // Σ = the four buckets summed ourselves
		});
	});

	it("collapses an empty session to a single friendly row", () => {
		assert.deepEqual(formatStatsLines(EMPTY_STATS), ["no messages yet"]);
	});

	it("interleaves the enriched rows only when their facts exist", () => {
		const lines = formatStatsLines(
			computeSessionStats([
				assistantEntry({
					usage: { input: 1000, output: 40_000, reasoning: 8200, cost: { total: 1.5 } },
					content: [
						{ type: "toolCall", name: "read", arguments: {} },
						{ type: "toolCall", name: "edit", arguments: {} },
					],
					stopReason: "aborted",
				}),
				{ type: "message", message: { role: "toolResult", toolName: "read", isError: true } },
			]),
		);
		assert.deepEqual(
			lines.map((line) => line.slice(0, line.indexOf(":"))),
			["tokens", "thinking", "cost", "turns", "tools", "stops"],
		);
		assert.match(lines[1]!, /^thinking:\s+8\.2k \(21% of output\)$/);
		assert.match(lines[2]!, /^cost:\s+\$1\.50$/);
		assert.match(lines[4]!, /^tools:\s+read 1 \(1\) · edit 1$/);
		assert.match(lines[5]!, /^stops:\s+1 aborted$/);
		assert.ok(!lines.some((line) => line.startsWith("cache"))); // no cache read yet
	});

	it("renders legacy snapshots that predate the enriched fields", () => {
		const legacy = { ...EMPTY_STATS } as Partial<SessionStats>;
		delete (legacy as Record<string, unknown>).costTotal;
		delete (legacy as Record<string, unknown>).reasoning;
		delete (legacy as Record<string, unknown>).toolCounts;
		delete (legacy as Record<string, unknown>).toolFails;
		delete (legacy as Record<string, unknown>).stops;
		const lines = formatStatsLines({
			...legacy,
			input: 100,
			output: 50,
			total: 150,
			prompts: 1,
			responses: 1,
			toolCalls: 2,
		} as SessionStats);
		assert.equal(lines.length, 2);
		assert.match(lines[0]!, /^tokens:/);
		assert.match(lines[1]!, /^turns:/);
	});
});

describe("paintStatsView", () => {
	it("wraps the card in a dashed frame that hugs the widest row", () => {
		const lines = paintStatsView(EMPTY_STATS, 80);
		assert.equal(lines.length, 5); // top + blank + one row + blank + bottom
		assert.match(lines[0]!, /^ ╭┄┄ Usage Stats ┄┄╮$/); // left-set title, two dashes of gap
		assert.match(lines[1]!, /^ │\s+│$/);
		assert.match(lines[2]!, /^ │ no messages yet │$/);
		assert.match(lines[3]!, /^ │\s+│$/);
		assert.match(lines[4]!, /^ ╰┄+╯$/);
		const frameWidth = lines[0]!.length;
		for (const line of lines) assert.equal(line.length, frameWidth);
	});

	it("clamps the frame to narrow terminals without spilling", () => {
		const stats = computeSessionStats([
			{ type: "message", message: { role: "user" } },
			assistantEntry({ usage: { input: 12_300, output: 45_600 } }),
		]);
		const width = 24;
		for (const line of paintStatsView(stats, width)) {
			assert.ok(line.length <= width);
		}
	});

	it("paints label heads muted ahead of the colon when a theme is given", () => {
		const stats = computeSessionStats([assistantEntry({ usage: { input: 12_300, output: 45_600 } })]);
		const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
		const lines = paintStatsView(stats, 80, theme);
		assert.match(lines[0]!, /<muted> Usage Stats <\/muted>/); // title joins the muted family
		assert.match(lines[2]!, /│ <muted>tokens:\s+<\/muted>↑12k ↓46k R0 W0 · Σ58k\s+│$/);
		assert.ok(!lines.some((line) => line.includes("<muted>↑"))); // values stay unpainted
	});

	it("drops the title when the clamped frame gets too tight", () => {
		const stats = computeSessionStats([
			{ type: "message", message: { role: "user" } },
			assistantEntry({ usage: { input: 12_300, output: 45_600 } }),
		]);
		const lines = paintStatsView(stats, 10);
		assert.match(lines[0]!, /^ ╭┄+╮$/);
		for (const line of lines) assert.ok(line.length <= 10);
	});
});
