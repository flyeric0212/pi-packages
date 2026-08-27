import { CHROME_LEFT_PAD } from "../config.ts";
import {
	assistantCacheUsages,
	cumulativeCacheHitRate,
	fallbackIfStale,
	formatCacheHit,
	formatTokens,
	finiteOrZero,
	isStaleExtensionError,
} from "../utils.ts";
import { sliceByColumn, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const STATS_CUSTOM_TYPE = "craft-stats";

/** Codex-login-style dashed frame; swap glyphs here if a font renders ┄ poorly. */
const FRAME_TOP_LEFT = "╭";
const FRAME_TOP_RIGHT = "╮";
const FRAME_BOTTOM_LEFT = "╰";
const FRAME_BOTTOM_RIGHT = "╯";
const FRAME_HORIZONTAL = "┄";
const FRAME_VERTICAL = "│";

/** Title set into the top border's left edge; ASCII so width equals length. */
const CARD_TITLE = " Usage Stats ";
/** Dashes required on each side of the title before we render it at all. */
const MIN_TITLE_DASHES = 2;
/** Below this interior width the title cannot fit and drops off the border. */
const TITLE_MIN_FRAME = CARD_TITLE.length + MIN_TITLE_DASHES * 2;

/** Structural slice of a branch entry that `/stats` reads. */
export type StatsEntry = {
	type?: string;
	timestamp?: string;
	message?: {
		role?: string;
		stopReason?: string;
		/** toolResult-only: which tool ran and whether it failed. */
		toolName?: string;
		isError?: boolean;
		usage?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			reasoning?: number;
			totalTokens?: number;
			cost?: { total?: number };
		};
		content?: unknown;
	};
};

/**
 * Cumulative facts for the current branch. `total` sums the four token
 * buckets ourselves instead of trusting provider-reported `totalTokens`,
 * whose definition varies by vendor (some exclude cache fields, some fold
 * reasoning in differently); summing keeps the card self-consistent.
 *
 * The enriched facts stay inside the same billing scope: cost and reasoning
 * come from assistant `usage` only, while tool failures (`toolResult.isError`)
 * are counted but never contribute tokens or money.
 */
export type SessionStats = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	/** Σ provider-reported `usage.cost.total`; null until one finite report. */
	costTotal: number | null;
	/** Σ provider-reported `usage.reasoning`; null until one numeric report. */
	reasoning: number | null;
	cacheHitPercent: number | null;
	prompts: number;
	responses: number;
	toolCalls: number;
	/** Calls per tool name, insertion-ordered; drives the ranked tools row. */
	toolCounts: Record<string, number>;
	/** Failed executions per tool (`toolResult.isError`), outside the token scope. */
	toolFails: Record<string, number>;
	/** Assistant turns that ended in something other than stop/toolUse. */
	stops: { aborted: number; length: number; error: number };
	durationMs: number | null;
};

export const EMPTY_STATS: SessionStats = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	total: 0,
	costTotal: null,
	reasoning: null,
	cacheHitPercent: null,
	prompts: 0,
	responses: 0,
	toolCalls: 0,
	toolCounts: {},
	toolFails: {},
	stops: { aborted: 0, length: 0, error: 0 },
	durationMs: null,
};

type StatsManager = { getBranch(): readonly StatsEntry[] };

/** Live session reads must not throw after /reload. Same contract as clear.ts. */
function branchOrEmpty(manager: StatsManager | undefined): readonly StatsEntry[] {
	if (!manager) return [];
	try {
		return manager.getBranch();
	} catch (error) {
		if (isStaleExtensionError(error)) return [];
		throw error;
	}
}

/**
 * Walk the branch once. Token and cost facts come from assistant usage only
 * (toolResult usage is a different billing story; noted here so nobody "fixes"
 * it silently — `isError` counting reads the flag, never its usage). The
 * elapsed time anchors on branch-first/branch-last entry timestamps, which
 * every SessionEntry carries publicly.
 */
export function computeSessionStats(entries: readonly StatsEntry[]): SessionStats {
		const stats: SessionStats = { ...EMPTY_STATS, toolCounts: {}, toolFails: {}, stops: { ...EMPTY_STATS.stops } };
	let firstTs: number | undefined;
	let lastTs: number | undefined;
	for (const entry of entries) {
		const ts = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
		if (Number.isFinite(ts)) {
			if (firstTs === undefined) firstTs = ts;
			lastTs = ts;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!message) continue;
		if (message.role === "user") {
			stats.prompts += 1;
		} else if (message.role === "assistant") {
			stats.responses += 1;
			const usage = message.usage;
			if (usage) {
				stats.input += finiteOrZero(usage.input);
				stats.output += finiteOrZero(usage.output);
				stats.cacheRead += finiteOrZero(usage.cacheRead);
				stats.cacheWrite += finiteOrZero(usage.cacheWrite);
				if (typeof usage.reasoning === "number" && Number.isFinite(usage.reasoning)) {
					stats.reasoning = (stats.reasoning ?? 0) + usage.reasoning;
				}
				const reportedCost = usage.cost?.total;
				if (typeof reportedCost === "number" && Number.isFinite(reportedCost)) {
					stats.costTotal = (stats.costTotal ?? 0) + reportedCost;
				}
			}
			switch (message.stopReason) {
				case "aborted":
					stats.stops.aborted += 1;
					break;
				case "length":
					stats.stops.length += 1;
					break;
				case "error":
					stats.stops.error += 1;
					break;
			}
			if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block != null && typeof block === "object" && (block as { type?: unknown }).type === "toolCall") {
						stats.toolCalls += 1;
						const name = (block as { name?: unknown }).name;
						if (typeof name === "string" && name.length > 0) {
							stats.toolCounts[name] = (stats.toolCounts[name] ?? 0) + 1;
						}
					}
				}
			}
		} else if (message.role === "toolResult") {
			if (
				message.isError === true &&
				typeof message.toolName === "string" &&
				message.toolName.length > 0
			) {
				stats.toolFails[message.toolName] = (stats.toolFails[message.toolName] ?? 0) + 1;
			}
		}
	}
	stats.total = stats.input + stats.output + stats.cacheRead + stats.cacheWrite;
	stats.cacheHitPercent = cumulativeCacheHitRate(assistantCacheUsages(entries));
	stats.durationMs =
		firstTs !== undefined && lastTs !== undefined && lastTs >= firstTs ? lastTs - firstTs : null;
	return stats;
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

type StatRow = { label: string; value: string };

/** Structural theme slice used to mute labels; same idiom as ClearTheme. */
export type StatsTheme = {
	fg(color: string, text: string): string;
};

/**
 * All distinct tools are listed by rank; this cap only guards runaway sessions
 * (MCP/skill packs can contribute dozens of names), folding the overflow into
 * `+N kinds`.
 */
export const TOOL_KINDS_SHOWN = 12;

/**
 * Adaptive dollar precision: two decimals once past a cent, four below it, so
 * a cheap session never renders as `$0.00`.
 */
export function formatCostTotal(cost: number | null | undefined): string | undefined {
	if (cost == null || !Number.isFinite(cost)) return undefined;
	return cost > 0 && cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

/** `8.2k (18% of output)`; hidden until a provider reported reasoning tokens. */
export function formatReasoningShare(reasoning: number | null | undefined, output: number): string | undefined {
	if (reasoning == null || !Number.isFinite(reasoning) || reasoning <= 0) return undefined;
	if (output <= 0) return formatTokens(reasoning);
	const percent = Math.round((reasoning / output) * 100);
	return `${formatTokens(reasoning)} (${percent}% of output)`;
}

/**
 * Every distinct tool by call count, ranked desc; only tools with failures
 * carry a bare `(N)` suffix (their failure count). Hidden when nothing ran
 * and nothing failed. The `+N kinds` fold is only a runaway guard for
 * MCP/skill packs. A failure without a recorded call (unreachable in
 * practice, e.g. across a compaction boundary) still renders as `name (N)`.
 */
export function formatToolBreakdown(
	toolCalls: number,
	toolFails: Record<string, number> | undefined,
	toolCounts: Record<string, number> | undefined,
): string | undefined {
	const counts = toolCounts ?? {};
	const fails = toolFails ?? {};
	const names = new Set([...Object.keys(counts), ...Object.keys(fails)]);
	if (toolCalls === 0 && names.size === 0) return undefined;
	const ranked = [...names].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
	const parts = ranked.slice(0, TOOL_KINDS_SHOWN).map((name) => {
		const fail = fails[name] ?? 0;
		if (counts[name] === undefined) return `${name} (${fail})`;
		const base = `${name} ${counts[name]}`;
		return fail > 0 ? `${base} (${fail})` : base;
	});
	if (ranked.length > TOOL_KINDS_SHOWN) parts.push(`+${ranked.length - TOOL_KINDS_SHOWN} kinds`);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Only abnormal endings surface; an all-normal session hides this row. */
export function formatStops(stops: SessionStats["stops"] | undefined): string | undefined {
	const parts: string[] = [];
	const safe = stops ?? { aborted: 0, length: 0, error: 0 };
	if (safe.aborted > 0) parts.push(`${safe.aborted} aborted`);
	if (safe.length > 0) parts.push(`${safe.length} length`);
	if (safe.error > 0) parts.push(`${safe.error} error`);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function statRows(stats: SessionStats): StatRow[] {
	if (stats.prompts === 0 && stats.responses === 0) return [{ label: "", value: "no messages yet" }];
	const tokens = `↑${formatTokens(stats.input)} ↓${formatTokens(stats.output)} R${formatTokens(
		stats.cacheRead,
	)} W${formatTokens(stats.cacheWrite)} · Σ${formatTokens(stats.total)}`;
	const cache = formatCacheHit(stats.cacheHitPercent);
	const turns = `${stats.prompts} prompts · ${stats.responses} responses · ${stats.toolCalls} tool calls`;
	// Legacy snapshots (pre-enrichment cards re-rendered from their stored
	// snapshot) lack these fields; every read defaults instead of crashing.
	const rows: StatRow[] = [{ label: "tokens", value: tokens }];
	const thinking = formatReasoningShare(stats.reasoning, stats.output);
	if (thinking) rows.push({ label: "thinking", value: thinking });
	if (cache) rows.push({ label: "cache", value: cache });
	const cost = formatCostTotal(stats.costTotal);
	if (cost) rows.push({ label: "cost", value: cost });
	rows.push({ label: "turns", value: turns });
	const tools = formatToolBreakdown(stats.toolCalls, stats.toolFails, stats.toolCounts);
	if (tools) rows.push({ label: "tools", value: tools });
	const stops = formatStops(stats.stops);
	if (stops) rows.push({ label: "stops", value: stops });
	if (stats.durationMs != null) rows.push({ label: "time", value: formatDuration(stats.durationMs) });
	return rows;
}

/** Colon-separated head (`tokens:  `), padded so every value starts on one column. */
function statRowHead(label: string, labelWidth: number): string {
	return label ? `${`${label}:`.padEnd(labelWidth)}  ` : "";
}

/**
 * Column-aligned plain-text rows. Rows whose fact is not knowable yet are
 * omitted rather than dashed: the footer already established "hide until a
 * cache read" as this package's idiom for absent metrics.
 */
export function formatStatsLines(stats: SessionStats): string[] {
	const rows = statRows(stats);
	const labelWidth = Math.max(...rows.map(({ label }) => label.length + 1));
	return rows.map(({ label, value }) => statRowHead(label, labelWidth) + value);
}

/**
 * Rendered from the snapshot stored in the entry at invocation time, so any
 * later frame (scrollback included) formats stored numbers in O(1) instead of
 * rescanning the branch. The card sits inside a dashed frame that hugs its
 * widest row and clamps to the terminal; the title sits at the top border's
 * left edge with blank rows above and below the body for breathing room.
 */
export function paintStatsView(data: SessionStats, width: number, theme?: StatsTheme): string[] {
	const outer = Math.max(0, width - CHROME_LEFT_PAD);
	const pad = " ".repeat(CHROME_LEFT_PAD);
	const rows = statRows(data);
	const labelWidth = Math.max(...rows.map(({ label }) => label.length + 1));
	const lines = rows.map(({ label, value }) => {
		const head = statRowHead(label, labelWidth);
		return head && theme ? theme.fg("muted", head) + value : head + value;
	});
	// One blank column of breathing room on each side of the content. A titled
	// frame keeps a minimum width even for short cards, but still clamps to
	// the terminal; below that the title drops off and the frame hugs content.
	const contentWidth = Math.max(...lines.map((line) => visibleWidth(line))) + 2;
	const frameInner = Math.max(
		0,
		Math.min(Math.max(contentWidth, TITLE_MIN_FRAME), Math.max(0, outer - 2)),
	);
	const horizontal = FRAME_HORIZONTAL.repeat(frameInner);
	const rightDashes = frameInner - CARD_TITLE.length - MIN_TITLE_DASHES;
	let top = pad + FRAME_TOP_LEFT + horizontal + FRAME_TOP_RIGHT;
	if (rightDashes >= MIN_TITLE_DASHES) {
		const label = theme ? theme.fg("muted", CARD_TITLE) : CARD_TITLE;
		top =
			pad +
			FRAME_TOP_LEFT +
			FRAME_HORIZONTAL.repeat(MIN_TITLE_DASHES) +
			label +
			FRAME_HORIZONTAL.repeat(rightDashes) +
			FRAME_TOP_RIGHT;
	}
	const blank = `${pad}${FRAME_VERTICAL}${" ".repeat(frameInner)}${FRAME_VERTICAL}`;
	const body = lines.map((line) => {
		// ANSI-aware: sliceByColumn keeps SGR codes intact, and visibleWidth
		// measures styled text by its terminal columns.
		const cell = sliceByColumn(line, 0, Math.max(0, frameInner - 2));
		const filler = " ".repeat(Math.max(0, frameInner - 1 - visibleWidth(cell)));
		return `${pad}${FRAME_VERTICAL} ${cell}${filler}${FRAME_VERTICAL}`;
	});
	return [
		top,
		blank,
		...body,
		blank,
		pad + FRAME_BOTTOM_LEFT + horizontal + FRAME_BOTTOM_RIGHT,
	];
}

export class StatsView implements Component {
	private readonly data: SessionStats;
	private readonly theme?: StatsTheme;
	private cachedWidth = -1;
	private cachedLines: string[] | undefined;

	constructor(data: SessionStats | undefined, theme?: StatsTheme) {
		this.data = data ?? EMPTY_STATS;
		this.theme = theme;
	}

	render(width: number): string[] {
		if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
		this.cachedWidth = width;
		this.cachedLines = paintStatsView(this.data, width, this.theme);
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedLines = undefined;
	}

	dispose(): void {}
}

const DESCRIPTION = "Show cumulative token, cache, turn, and time stats for the current branch";

export function installStats(pi: ExtensionAPI): void {
	let manager: StatsManager | undefined;

	pi.on("session_start", (_event, ctx) => {
		manager = ctx.sessionManager;
	});

	pi.on("session_shutdown", () => {
		manager = undefined;
	});

	pi.registerEntryRenderer<SessionStats>(STATS_CUSTOM_TYPE, (entry, _options, theme) => {
		return new StatsView(entry.data, theme);
	});

	pi.registerCommand("stats", {
		description: DESCRIPTION,
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			if (ctx.mode !== "tui") return;
			let stats: SessionStats;
			try {
				stats = computeSessionStats(fallbackIfStale(() => manager?.getBranch() ?? [], []));
			} catch (error) {
				if (isStaleExtensionError(error)) return;
				throw error;
			}
			pi.appendEntry<SessionStats>(STATS_CUSTOM_TYPE, stats);
		},
	});
}
