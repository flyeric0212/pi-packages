import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	computeSessionStats,
	EMPTY_STATS,
	formatDuration,
	formatStatsLines,
	paintStatsView,
	type StatsEntry,
} from "../extensions/commands/stats.ts";
import { cumulativeCacheHitRate } from "../extensions/utils.ts";

function assistantEntry(overrides: {
	usage?: Record<string, number>;
	content?: unknown;
	timestamp?: string;
}): StatsEntry {
	return {
		type: "message",
		timestamp: overrides.timestamp,
		message: {
			role: "assistant",
			usage: overrides.usage,
			content: overrides.content ?? [{ type: "text", text: "ok" }],
		},
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

describe("formatDuration", () => {
	it("buckets into h/m/s without trailing zeros", () => {
		assert.equal(formatDuration(59_000), "59s");
		assert.equal(formatDuration(61_000), "1m 1s");
		assert.equal(formatDuration(3 * 3600_000 + 2 * 60_000), "3h 2m");
		assert.equal(formatDuration(-5), "0s");
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
			assert.match(lines[0]!, /^tokens\s+↑12k ↓46k R0 W0 · Σ58k$/);
			assert.ok(!lines.some((line) => line.startsWith("cache"))); // no cache read yet
			assert.match(lines[2]!, /^time\s+30m 0s$/);
		});

		it("shows the cache row once a read exists, keeping Σ over all four buckets", () => {
			const lines = formatStatsLines(computeSessionStats([
				assistantEntry({ usage: { input: 12_300, output: 45_600, cacheRead: 230_000, cacheWrite: 1_200 } }),
			]));
			assert.match(lines[1]!, /^cache\s+CH[\d.]+%$/);
			assert.match(lines[0]!, /Σ289k$/); // Σ = the four buckets summed ourselves
		});
	});

	it("collapses an empty session to a single friendly row", () => {
		assert.deepEqual(formatStatsLines(EMPTY_STATS), ["no messages yet"]);
	});
});

describe("paintStatsView", () => {
	it("wraps the card in a dashed frame that hugs the widest row", () => {
		const lines = paintStatsView(EMPTY_STATS, 80);
		assert.equal(lines.length, 3); // top + one row + bottom
		assert.match(lines[0]!, /^ ╭┄+╮$/);
		assert.match(lines[1]!, /^ │ no messages yet │$/);
		assert.match(lines[2]!, /^ ╰┄+╯$/);
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
});
