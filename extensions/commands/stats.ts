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

/** Structural slice of a branch entry that `/stats` reads. */
export type StatsEntry = {
	type?: string;
	timestamp?: string;
	message?: {
		role?: string;
		usage?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			reasoning?: number;
			totalTokens?: number;
		};
		content?: unknown;
	};
};

/**
 * Cumulative facts for the current branch. `total` sums the four token
 * buckets ourselves instead of trusting provider-reported `totalTokens`,
 * whose definition varies by vendor (some exclude cache fields, some fold
 * reasoning in differently); summing keeps the card self-consistent.
 */
export type SessionStats = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cacheHitPercent: number | null;
	prompts: number;
	responses: number;
	toolCalls: number;
	durationMs: number | null;
};

export const EMPTY_STATS: SessionStats = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	total: 0,
	cacheHitPercent: null,
	prompts: 0,
	responses: 0,
	toolCalls: 0,
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
 * Walk the branch once. v1 scope: assistant usage only (toolResult usage is a
 * different billing story; noted here so nobody "fixes" it silently). The
 * elapsed time anchors on branch-first/branch-last entry timestamps, which
 * every SessionEntry carries publicly.
 */
export function computeSessionStats(entries: readonly StatsEntry[]): SessionStats {
	const stats: SessionStats = { ...EMPTY_STATS };
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
			}
			if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block != null && typeof block === "object" && (block as { type?: unknown }).type === "toolCall") {
						stats.toolCalls += 1;
					}
				}
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

/**
 * Column-aligned plain-text rows. Rows whose fact is not knowable yet are
 * omitted rather than dashed: the footer already established "hide until a
 * cache read" as this package's idiom for absent metrics.
 */
export function formatStatsLines(stats: SessionStats): string[] {
	if (stats.prompts === 0 && stats.responses === 0) return ["no messages yet"];
	const tokens = `↑${formatTokens(stats.input)} ↓${formatTokens(stats.output)} R${formatTokens(
		stats.cacheRead,
	)} W${formatTokens(stats.cacheWrite)} · Σ${formatTokens(stats.total)}`;
	const cache = formatCacheHit(stats.cacheHitPercent);
	const turns = `${stats.prompts} prompts · ${stats.responses} responses · ${stats.toolCalls} tool calls`;
	const rows: Array<[string, string]> = [["tokens", tokens]];
	if (cache) rows.push(["cache", cache]);
	rows.push(["turns", turns]);
	if (stats.durationMs != null) rows.push(["time", formatDuration(stats.durationMs)]);
	const labelWidth = Math.max(...rows.map(([label]) => label.length));
	return rows.map(([label, value]) => `${label.padEnd(labelWidth)}  ${value}`);
}

/**
 * Rendered from the snapshot stored in the entry at invocation time, so any
 * later frame (scrollback included) formats stored numbers in O(1) instead of
 * rescanning the branch. The card sits inside a dashed frame that hugs its
 * widest row and clamps to the terminal.
 */
export function paintStatsView(data: SessionStats, width: number): string[] {
	const outer = Math.max(0, width - CHROME_LEFT_PAD);
	const pad = " ".repeat(CHROME_LEFT_PAD);
	const rows = formatStatsLines(data);
	// One blank column of breathing room on each side of the content.
	const frameInner = Math.max(
		0,
		Math.min(
			Math.max(...rows.map((row) => visibleWidth(row))) + 2,
			Math.max(0, outer - 2),
		),
	);
	const horizontal = FRAME_HORIZONTAL.repeat(frameInner);
	const body = rows.map((row) => {
		// sliceByColumn cuts without appending SGR resets, keeping raw lengths equal
		// to visible widths for the padding math below.
		const cell = sliceByColumn(row, 0, Math.max(0, frameInner - 2));
		const filler = " ".repeat(Math.max(0, frameInner - 1 - visibleWidth(cell)));
		return `${pad}${FRAME_VERTICAL} ${cell}${filler}${FRAME_VERTICAL}`;
	});
	return [
		pad + FRAME_TOP_LEFT + horizontal + FRAME_TOP_RIGHT,
		...body,
		pad + FRAME_BOTTOM_LEFT + horizontal + FRAME_BOTTOM_RIGHT,
	];
}

export class StatsView implements Component {
	private readonly data: SessionStats;
	private cachedWidth = -1;
	private cachedLines: string[] | undefined;

	constructor(data: SessionStats | undefined) {
		this.data = data ?? EMPTY_STATS;
	}

	render(width: number): string[] {
		if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
		this.cachedWidth = width;
		this.cachedLines = paintStatsView(this.data, width);
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

	pi.registerEntryRenderer<SessionStats>(STATS_CUSTOM_TYPE, (entry) => new StatsView(entry.data));

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
