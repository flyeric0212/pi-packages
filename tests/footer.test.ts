import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assistantCacheUsages,
	cacheHitRate,
	cacheHitTone,
	contextTone,
	formatCacheHit,
	formatContextUsage,
	formatHomePath,
	formatFooterModelThinking,
	formatModelThinking,
	formatTokens,
	cumulativeCacheHitRate,
	paintFooterModelThinking,
	paintModelThinking,
	thinkingThemeColor,
	compactProjectPath,
} from "../extensions/utils.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { FOOTER_SLOT_ORDER, fitFooter, footerSlotText, formatStatusLine, paintFooter, renderFooter } from "../extensions/footer/footer.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

function stubTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
	} as Theme;
}

describe("token and context formatting", () => {
	it("formats thousands as k", () => {
		assert.equal(formatTokens(126_000), "126k");
		assert.equal(formatTokens(400_000), "400k");
		assert.equal(formatTokens(42), "42");
	});

	it("renders missing context as placeholders", () => {
		assert.equal(formatContextUsage(null, null), "—/—");
		assert.equal(formatContextUsage(126_000, 400_000), "126k/400k");
	});

	it("maps context percent to tone thresholds", () => {
		assert.equal(contextTone(null), "text");
		assert.equal(contextTone(69.9), "success");
		assert.equal(contextTone(70), "warning");
		assert.equal(contextTone(90), "error");
	});
});

describe("cache hit rate", () => {
	it("uses cacheRead over prompt tokens including cache write", () => {
		assert.equal(cacheHitRate({ input: 20, cacheRead: 80, cacheWrite: 0 }), 80);
		assert.equal(cacheHitRate({ input: 10, cacheRead: 70, cacheWrite: 20 }), 70);
	});

	it("returns nothing when the prompt is empty or usage is missing", () => {
		assert.equal(cacheHitRate(undefined), null);
		assert.equal(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 }), null);
		assert.equal(cacheHitRate({ input: Number.NaN }), null);
	});

	it("hides until the branch has reported cacheRead", () => {
		assert.equal(cumulativeCacheHitRate([]), null);
		assert.equal(cumulativeCacheHitRate([{ input: 100, cacheRead: 0, cacheWrite: 0 }]), null);
		assert.equal(cumulativeCacheHitRate([{ input: 10, cacheRead: 0, cacheWrite: 100 }]), null);
	});

	it("sums the branch instead of keeping the latest request", () => {
		assert.equal(
			cumulativeCacheHitRate([
				{ input: 50, cacheRead: 50, cacheWrite: 0 },
				{ input: 10, cacheRead: 90, cacheWrite: 0 },
			]),
			70,
		);
	});

	it("keeps cacheWrite in the cumulative denominator", () => {
		assert.equal(
			cumulativeCacheHitRate([
				{ input: 10, cacheRead: 0, cacheWrite: 100 },
				{ input: 10, cacheRead: 100, cacheWrite: 0 },
			]),
			(100 / 220) * 100,
		);
	});

	it("reads only assistant message usage from the branch", () => {
		assert.deepEqual(
			assistantCacheUsages([
				{ type: "message", message: { role: "user" } },
				{ type: "message", message: { role: "assistant", usage: { input: 20, cacheRead: 80, cacheWrite: 0 } } },
				{ type: "compaction" },
				{ type: "message", message: { role: "toolResult", usage: { input: 1, cacheRead: 9, cacheWrite: 0 } } },
			]),
			[{ input: 20, cacheRead: 80, cacheWrite: 0 }],
		);
	});

	it("formats one decimal and omits the segment when hidden", () => {
		assert.equal(formatCacheHit(null), undefined);
		assert.equal(formatCacheHit(87.34), "CH87.3%");
		assert.equal(formatCacheHit(0), "CH0.0%");
	});

	it("maps cache hit to syntaxKeyword, warning, and error", () => {
		assert.equal(cacheHitTone(null), undefined);
		assert.equal(cacheHitTone(29.9), "error");
		assert.equal(cacheHitTone(30), "warning");
		assert.equal(cacheHitTone(69.9), "warning");
		assert.equal(cacheHitTone(70), "syntaxKeyword");
	});
});

describe("model and thinking", () => {
	it("joins header model and thinking as 'level effort' with a category dot", () => {
		assert.equal(formatModelThinking("gpt-5.6-sol", "high"), "gpt-5.6-sol · high effort");
		assert.equal(formatModelThinking("gpt-5.6-sol", "max"), "gpt-5.6-sol · max effort");
		assert.equal(formatModelThinking("gpt-5.6-sol", "off"), "gpt-5.6-sol");
		assert.equal(formatModelThinking("gpt-5.6-sol", undefined), "gpt-5.6-sol");
		assert.equal(formatModelThinking("gpt-5.6-sol", "  "), "gpt-5.6-sol");
	});

	it("joins footer model and thinking with a space and no effort label", () => {
		assert.equal(formatFooterModelThinking("gpt-5.6-sol", "high"), "gpt-5.6-sol high");
		assert.equal(formatFooterModelThinking("gpt-5.6-sol", "max"), "gpt-5.6-sol max");
		assert.equal(formatFooterModelThinking("gpt-5.6-sol", "off"), "gpt-5.6-sol");
	});

	it("maps each thinking level to the matching theme token", () => {
		assert.equal(thinkingThemeColor("off"), "thinkingOff");
		assert.equal(thinkingThemeColor("minimal"), "thinkingMinimal");
		assert.equal(thinkingThemeColor("low"), "thinkingLow");
		assert.equal(thinkingThemeColor("medium"), "thinkingMedium");
		assert.equal(thinkingThemeColor("high"), "thinkingHigh");
		assert.equal(thinkingThemeColor("xhigh"), "thinkingXhigh");
		assert.equal(thinkingThemeColor("max"), "thinkingMax");
		assert.equal(thinkingThemeColor(undefined), "thinkingText");
		assert.equal(thinkingThemeColor("unknown"), "thinkingText");
	});

	it("paints only the thinking level with the thinking-level color", () => {
		const theme = {
			fg: (color: string, text: string) => `[${color}]${text}`,
		} as Theme;
		assert.equal(
			paintModelThinking("DeepSeek V4 Flash", "max", theme, "muted"),
			"[muted]DeepSeek V4 Flash[dim] · [thinkingMax]max[muted] effort",
		);
		assert.equal(paintModelThinking("DeepSeek V4 Flash", "off", theme, "muted"), "[muted]DeepSeek V4 Flash");
		assert.equal(
			paintFooterModelThinking("DeepSeek V4 Flash", "max", theme),
			"[text]DeepSeek V4 Flash [thinkingMax]max",
		);
		assert.equal(paintFooterModelThinking("DeepSeek V4 Flash", "off", theme), "[text]DeepSeek V4 Flash");
	});
});

describe("path abbreviation", () => {
	it("replaces the home directory with ~", () => {
		assert.equal(formatHomePath("/Users/eric/Code/project", "/Users/eric"), "~/Code/project");
		assert.equal(formatHomePath("/Users/eric", "/Users/eric"), "~");
	});

	it("keeps the project directory when compacting", () => {
		assert.equal(compactProjectPath("~/Code/project"), "…/project");
	});
});

describe("footer fit", () => {
	const base = {
		modelName: "gpt-5.6-sol",
		modelId: "gpt-5.6-sol",
		thinking: "high",
		usedTokens: 126_000,
		contextWindow: 400_000,
		percent: 31,
		cwd: "/Users/eric/Code/project",
		tps: 42,
		cacheHit: null,
	};

	it("exposes slots in the locked order without adding fields", () => {
		assert.deepEqual([...FOOTER_SLOT_ORDER], ["modelThinking", "context", "cwd", "tps", "cache"]);
		const slots = footerSlotText(fitFooter(base, 120, "/Users/eric"));
		assert.deepEqual(Object.keys(slots), [...FOOTER_SLOT_ORDER]);
	});

	it("keeps field order on a wide terminal", () => {
		const fitted = fitFooter(base, 120, "/Users/eric");
		assert.equal(fitted.model, "gpt-5.6-sol");
		assert.equal(fitted.thinking, "high");
		assert.equal(fitted.context, "126k/400k");
		assert.equal(fitted.cwd, "~/Code/project");
		assert.equal(fitted.tps, "42 tok/s");
		assert.equal(fitted.cache, undefined);
		assert.equal(fitted.tone, "success");
	});

	it("appends cache hit after tps and hides it when there is no cache", () => {
		const withCache = fitFooter({ ...base, cacheHit: 87.34 }, 120, "/Users/eric");
		assert.equal(withCache.cache, "CH87.3%");
		assert.equal(withCache.cacheTone, "syntaxKeyword");
		const line = [
			formatFooterModelThinking(withCache.model, withCache.thinking),
			withCache.context,
			withCache.cwd,
			withCache.tps,
			withCache.cache,
		]
			.filter(Boolean)
			.join(" · ");
		assert.equal(line, "gpt-5.6-sol high · 126k/400k · ~/Code/project · 42 tok/s · CH87.3%");

		const hidden = fitFooter(base, 120, "/Users/eric");
		assert.equal(hidden.cache, undefined);
		const withoutCache = [
			formatFooterModelThinking(hidden.model, hidden.thinking),
			hidden.context,
			hidden.cwd,
			hidden.tps,
		]
			.filter(Boolean)
			.join(" · ");
		assert.equal(withoutCache, "gpt-5.6-sol high · 126k/400k · ~/Code/project · 42 tok/s");
		assert.ok(!withoutCache.includes("CH"));
	});

	it("compacts the directory before hiding higher-priority fields", () => {
		const fitted = fitFooter(
			{ ...base, cwd: "/Users/eric/very/long/nested/path/to/project" },
			64,
			"/Users/eric",
		);
		assert.ok(fitted.cwd === "…/project" || fitted.cwd?.includes("…"));
		assert.ok(fitted.cwd?.endsWith("project"));
		assert.equal(fitted.context, "126k/400k");
		assert.ok(fitted.model.length > 0);
	});

	it("shortens tok/s and then hides cwd and tps on very narrow terminals", () => {
		const fitted = fitFooter(base, 28, "/Users/eric");
		assert.equal(fitted.context, "126k/400k");
		assert.equal(fitted.thinking, "high");
		assert.equal(fitted.cwd, undefined);
	});

	it("never wraps the fitted core beyond the given width", () => {
		for (const width of [60, 80, 100, 120]) {
			const fitted = fitFooter({ ...base, cacheHit: 87.3 }, width, "/Users/eric");
			const line = [
				formatFooterModelThinking(fitted.model, fitted.thinking),
				fitted.context,
				fitted.cwd,
				fitted.tps,
				fitted.cache,
			]
				.filter(Boolean)
				.join(" · ");
			assert.ok(visibleWidth(line) <= width, `${line} wider than ${width}`);
			if (fitted.cache && fitted.tps) {
				assert.ok(line.endsWith(fitted.cache), "cache stays last when both optional fields remain");
			}
		}
	});

	it("uses warning and error tones at 70% and 90%", () => {
		assert.equal(fitFooter({ ...base, percent: 70 }, 80, "/Users/eric").tone, "warning");
		assert.equal(fitFooter({ ...base, percent: 90 }, 80, "/Users/eric").tone, "error");
	});

	it("paints model, context, and path readable, and tps accent", () => {
		const theme = {
			fg: (color: string, text: string) => `[${color}]${text}`,
		} as Theme;
		const painted = paintFooter(fitFooter(base, 120, "/Users/eric"), theme);
		assert.match(painted, /\[text\]gpt-5\.6-sol \[thinkingHigh\]high/);
		assert.match(painted, /\[success\]126k\/400k/);
		assert.match(painted, /\[text\]~\/Code\/project/);
		assert.match(painted, /\[accent\]42 tok\/s/);
		assert.ok(!painted.includes("CH"));
	});

	it("paints cache hit with the matching tone after tps", () => {
		const theme = {
			fg: (color: string, text: string) => `[${color}]${text}`,
		} as Theme;
		const painted = paintFooter(fitFooter({ ...base, cacheHit: 87.3 }, 120, "/Users/eric"), theme);
		assert.match(painted, /\[accent\]42 tok\/s.*\[syntaxKeyword\]CH87\.3%/);
		const low = paintFooter(fitFooter({ ...base, cacheHit: 12 }, 120, "/Users/eric"), theme);
		assert.match(low, /\[error\]CH12\.0%/);
	});
});

describe("extension status line", () => {
	it("returns nothing when there are no statuses", () => {
		assert.equal(formatStatusLine([], 80), undefined);
	});

	it("joins statuses with middle dots in given order and truncates", () => {
		const line = formatStatusLine(
			["permission: waiting for approval", "subagent: running"],
			80,
		);
		assert.equal(line, "permission: waiting for approval · subagent: running");
		const narrow = formatStatusLine(["permission: waiting for approval", "subagent: running"], 20);
		assert.ok(narrow);
		assert.ok(visibleWidth(narrow) <= 20);
		assert.ok(!narrow.includes("\n"));
	});

	it("places statuses directly above the metrics line with no extra blank row", () => {
		const fields = {
			modelName: "gpt-5.6-sol",
			thinking: "high",
			usedTokens: 100,
			contextWindow: 400_000,
			percent: 1,
			cwd: "/tmp",
			tps: null,
			cacheHit: null,
		};
		const withStatus = renderFooter(fields, ["permission: waiting"], 80, stubTheme());
		assert.equal(withStatus.length, 2);
		assert.match(withStatus[0]!, /permission: waiting/);
		assert.match(withStatus[1]!, /gpt-5.6-sol high/);
		assert.ok(!withStatus[1]!.includes("effort"));
		assert.ok(!withStatus[1]!.includes("gpt-5.6-sol · high"));
		assert.ok(withStatus[0]!.startsWith(" "));
		assert.ok(withStatus[1]!.startsWith(" "));
		const idle = renderFooter(fields, [], 80, stubTheme());
		assert.equal(idle.length, 1);
		assert.match(idle[0]!, /gpt-5.6-sol high/);
		assert.ok(!idle[0]!.includes("effort"));
		assert.ok(idle[0]!.startsWith(" "));
	});
});
