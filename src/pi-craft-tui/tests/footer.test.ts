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
	formatTps,
	cumulativeCacheHitRate,
	paintFooterModelThinking,
	paintModelThinking,
	thinkingThemeColor,
	compactProjectPath,
} from "../utils.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { cacheHitMemoKey, contextMemoKey, Memo, readLeafFacts, type LeafFacts } from "../footer/footer.ts";
import { FOOTER_SLOT_ORDER, fitFooter, footerSlotText, formatStatusLine, paintFooter, renderFooter } from "../footer/footer.ts";
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

	it("shows ellipsis while streaming without measurable output, dash otherwise", () => {
		assert.equal(formatTps(null, "tok/s", true), "… tok/s");
		assert.equal(formatTps(null, "tok/s", false), "— tok/s");
		assert.equal(formatTps(42, "tok/s", true), "42 tok/s");
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

	it("appends the git branch to the cwd slot and drops it with the slot", () => {
		const withBranch = fitFooter({ ...base, gitBranch: "main" }, 120, "/Users/eric");
		assert.equal(withBranch.cwd, "~/Code/project (main)");

		// The branch survives path compaction…
		const compact = fitFooter({ ...base, gitBranch: "main" }, 60, "/Users/eric");
		assert.ok(compact.cwd === undefined || /\(main\)$/.test(compact.cwd));

		// …and disappears exactly when the cwd slot does.
		const narrow = fitFooter({ ...base, gitBranch: "main" }, 28, "/Users/eric");
		assert.equal(narrow.cwd, undefined);

		// No branch in a repo-less session: no dangling parens.
		assert.ok(!fitFooter(base, 120, "/Users/eric").cwd?.includes("("));
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

describe("footer session facts memo keys", () => {
	function leaf(overrides: Partial<LeafFacts> = {}): LeafFacts {
		return {
			leafId: "leaf-1",
			branchLength: 3,
			entry: { id: "leaf-1", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
			...overrides,
		};
	}

	it("cache hit key ignores output growth and text growth during streaming", () => {
		const base = leaf();
		if (base.entry?.message) {
			base.entry.message.usage = { input: 10, output: 50, cacheRead: 4, cacheWrite: 1 };
		}
		const streaming = leaf();
		if (streaming.entry?.message) {
			streaming.entry.message.usage = { input: 10, output: 5000, cacheRead: 4, cacheWrite: 1 };
			streaming.entry.message.content = [{ type: "text", text: "hi there, much longer tail now" }];
		}
		assert.equal(cacheHitMemoKey(streaming), cacheHitMemoKey(base));
		assert.equal(cacheHitMemoKey(undefined), undefined);
	});

	it("cache hit key changes when prompt-cache fields or the leaf change", () => {
		const withCache = leaf();
		if (withCache.entry?.message) {
			withCache.entry.message.usage = { input: 10, output: 500, cacheRead: 4, cacheWrite: 1 };
		}
		const noCache = leaf();
		const otherLeaf = leaf({ leafId: "leaf-2" });
		assert.notEqual(cacheHitMemoKey(withCache), cacheHitMemoKey(noCache));
		assert.notEqual(cacheHitMemoKey(withCache), cacheHitMemoKey(otherLeaf));
	});

	it("keys change when compaction reshapes the branch without moving the leaf", () => {
		const before = leaf({ branchLength: 12 });
		const after = leaf({ branchLength: 4 });
		assert.notEqual(cacheHitMemoKey(before), cacheHitMemoKey(after));
		assert.notEqual(contextMemoKey(before, "m1"), contextMemoKey(after, "m1"));
	});

	it("context key tracks output, text, and model changes", () => {
		const base = leaf();
		const grew = leaf();
		if (grew.entry?.message) {
			grew.entry.message.content = [{ type: "text", text: "hi" }, { type: "text", text: " world" }];
		}
		const otherModel = leaf();
		assert.notEqual(contextMemoKey(base, "m1"), contextMemoKey(grew, "m1"));
		assert.notEqual(contextMemoKey(base, "m1"), contextMemoKey(base, "m2"));
		assert.equal(contextMemoKey(base, "m1"), contextMemoKey(leaf(), "m1"));
	});

	it("context key tracks thinking growth", () => {
		const base = leaf();
		if (base.entry?.message) {
			base.entry.message.content = [{ type: "thinking", thinking: "short" }];
		}
		const grew = leaf();
		if (grew.entry?.message) {
			grew.entry.message.content = [
				{ type: "thinking", thinking: "a much longer thinking chain that keeps growing while streaming" },
			];
		}
		assert.notEqual(contextMemoKey(base, "m1"), contextMemoKey(grew, "m1"));
	});

	it("context key tracks toolCall argument growth", () => {
		const base = leaf();
		if (base.entry?.message) {
			base.entry.message.content = [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }];
		}
		const grew = leaf();
		if (grew.entry?.message) {
			grew.entry.message.content = [
				{ type: "toolCall", name: "bash", arguments: { command: "ls -la a very long argument that keeps growing while streaming" } },
			];
		}
		assert.notEqual(contextMemoKey(base, "m1"), contextMemoKey(grew, "m1"));
	});

	it("context key tracks usage reasoning and totalTokens", () => {
		const base = leaf();
		if (base.entry?.message) {
			base.entry.message.usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 15 };
		}
		const withReasoning = leaf();
		if (withReasoning.entry?.message) {
			withReasoning.entry.message.usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 500, totalTokens: 15 };
		}
		const withTotal = leaf();
		if (withTotal.entry?.message) {
			withTotal.entry.message.usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 500, totalTokens: 2000 };
		}
		assert.notEqual(contextMemoKey(base, "m1"), contextMemoKey(withReasoning, "m1"));
		assert.notEqual(contextMemoKey(withReasoning, "m1"), contextMemoKey(withTotal, "m1"));
	});

	it("readLeafFacts swallows Pi's stale-ctx error", () => {
		const stale = {
			getLeafId() {
				throw new Error("This extension ctx is stale after session replacement or reload.");
			},
			getBranch() {
				return [];
			},
			getLeafEntry() {
				return undefined;
			},
		};
		assert.equal(readLeafFacts(stale), undefined);
		assert.equal(readLeafFacts(undefined), undefined);
	});
});

describe("footer memo", () => {
	it("reuses the computed value while the key is unchanged", () => {
		const memo = new Memo<number>();
		let computes = 0;
		const compute = (): number => {
			computes += 1;
			return 42;
		};
		assert.equal(memo.get("a", compute), 42);
		assert.equal(memo.get("a", compute), 42);
		assert.equal(computes, 1);
		assert.equal(memo.get("b", compute), 42);
		assert.equal(computes, 2);
	});

	it("never caches when the key is undefined", () => {
		const memo = new Memo<number>();
		let computes = 0;
		const compute = (): number => {
			computes += 1;
			return 1;
		};
		memo.get(undefined, compute);
		memo.get(undefined, compute);
		assert.equal(computes, 2);
	});

	it("caches undefined computed values while the key is unchanged", () => {
		const memo = new Memo<number | undefined>();
		let computes = 0;
		const compute = (): number | undefined => {
			computes += 1;
			return undefined;
		};
		memo.get("a", compute);
		memo.get("a", compute);
		assert.equal(computes, 1);
	});
});

describe("footer memo time clamp", () => {
	function tickingMemo(now: { value: number }): Memo<number> {
		return new Memo<number>({ minIntervalMs: 200, now: () => now.value });
	}

	it("serves identical fingerprints for free regardless of the clock", () => {
		const clock = { value: 0 };
		const memo = tickingMemo(clock);
		let computes = 0;
		const compute = (): number => {
			computes += 1;
			return computes;
		};
		assert.equal(memo.get("a", compute), 1);
		clock.value = 10_000;
		assert.equal(memo.get("a", compute), 1);
		assert.equal(computes, 1);
	});

	it("keeps the previous value inside the window without adopting the new key", () => {
		const clock = { value: 0 };
		const memo = tickingMemo(clock);
		let computes = 0;
		const compute = (): number => {
			computes += 1;
			return computes;
		};
		assert.equal(memo.get("a", compute), 1);
		clock.value = 100;
		assert.equal(memo.get("b", compute), 1);
		assert.equal(computes, 1);
		// The old key is kept, so the first frame after the window recomputes.
		clock.value = 250;
		assert.equal(memo.get("b", compute), 2);
		assert.equal(computes, 2);
	});

	it("recomputes immediately once the window has elapsed", () => {
		const clock = { value: 0 };
		const memo = tickingMemo(clock);
		let computes = 0;
		const compute = (): number => {
			computes += 1;
			return computes;
		};
		memo.get("a", compute);
		clock.value = 201;
		assert.equal(memo.get("b", compute), 2);
		assert.equal(computes, 2);
	});

	it("never caches an undefined key even inside the window", () => {
		const clock = { value: 0 };
		const memo = tickingMemo(clock);
		let computes = 0;
		const compute = (): number => {
			computes += 1;
			return computes;
		};
		assert.equal(memo.get(undefined, compute), 1);
		clock.value = 10;
		assert.equal(memo.get(undefined, compute), 2);
		// The undefined-key recompute refreshed the throttle (at most one
		// compute per interval, whatever triggered it), so a keyed change
		// right after it is clamped too.
		clock.value = 20;
		assert.equal(memo.get("a", compute), 2);
		clock.value = 250;
		assert.equal(memo.get("a", compute), 3);
		assert.equal(computes, 3);
	});

	it("skips the clamp when the injected clock moves backwards", () => {
		const clock = { value: 1000 };
		const memo = tickingMemo(clock);
		let computes = 0;
		const compute = (): number => {
			computes += 1;
			return computes;
		};
		memo.get("a", compute);
		clock.value = 900; // non-monotonic fallback clocks can jump backwards
		assert.equal(memo.get("b", compute), 2); // recompute, do not extend staleness
		assert.equal(computes, 2);
	});

	it("skips the window entirely when clamping is off for the call", () => {
		const clock = { value: 0 };
		const memo = tickingMemo(clock);
		let computes = 0;
		const compute = (): number => {
			computes += 1;
			return computes;
		};
		assert.equal(memo.get("a", compute, true), 1);
		clock.value = 50; // inside the window, but the caller turned clamping off
		assert.equal(memo.get("b", compute, false), 2);
		assert.equal(computes, 2);
	});
});

describe("footer render frames reuse the branch scan", () => {
	it("keeps the heavy branch usage scan out of streaming frames whose facts did not change", () => {
		let usageScans = 0;
		const manager = {
			getLeafId: () => "leaf-1",
			getLeafEntry: () => ({
				id: "leaf-1",
				message: {
					role: "assistant" as const,
					usage: { input: 10, output: 50, cacheRead: 4, cacheWrite: 1 },
					content: [{ type: "text", text: "growing text" }],
				},
			}),
			// O(1) length read for the fingerprint; counted separately from the
			// heavy per-entry walk that only the compute closure may trigger.
			getBranch: () => [
				{
					id: "leaf-1",
					type: "message" as const,
					message: { role: "assistant", usage: { input: 10, output: 50, cacheRead: 4, cacheWrite: 1 } },
				},
			],
		};
		const cacheHitMemo = new Memo<number | null>();
		const contextMemo = new Memo<{ tokens: number; percent: number } | undefined>();
		const renderFrame = (): void => {
			const leafFacts = readLeafFacts(manager);
			cacheHitMemo.get(cacheHitMemoKey(leafFacts), () => {
				usageScans += 1;
				return cumulativeCacheHitRate(assistantCacheUsages(manager.getBranch()));
			});
			contextMemo.get(contextMemoKey(leafFacts, "m1"), () => ({ tokens: 100, percent: 25 }), false);
		};
		renderFrame();
		renderFrame();
		renderFrame();
		assert.equal(usageScans, 1);
	});
});
