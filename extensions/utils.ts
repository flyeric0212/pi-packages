import { homedir } from "node:os";
import { basename } from "node:path";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	CACHE_HIT_DANGER_PERCENT,
	CACHE_HIT_WARN_PERCENT,
	CONTEXT_DANGER_PERCENT,
	CONTEXT_WARN_PERCENT,
	UNKNOWN,
} from "./config.ts";

export type ContextTone = "text" | "success" | "warning" | "error";
export type CacheTone = "syntaxKeyword" | "warning" | "error";

export type PromptCacheUsage = {
	input?: number;
	cacheRead?: number;
	cacheWrite?: number;
};

export function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n < 0) return UNKNOWN;
	if (n < 1000) return String(Math.round(n));
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

export function formatContextUsage(used: number | null, window: number | null): string {
	if (used == null || window == null || window <= 0) return `${UNKNOWN}/${UNKNOWN}`;
	return `${formatTokens(used)}/${formatTokens(window)}`;
}

export function contextTone(percent: number | null): ContextTone {
	if (percent == null || !Number.isFinite(percent)) return "text";
	if (percent >= CONTEXT_DANGER_PERCENT) return "error";
	if (percent >= CONTEXT_WARN_PERCENT) return "warning";
	return "success";
}

export function finiteOrZero(n: unknown): number {
	return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Prompt-cache hit rate: cacheRead / (input + cacheRead + cacheWrite). */
export function cacheHitRate(usage: PromptCacheUsage | undefined | null): number | null {
	if (usage == null) return null;
	const input = finiteOrZero(usage.input);
	const cacheRead = finiteOrZero(usage.cacheRead);
	const cacheWrite = finiteOrZero(usage.cacheWrite);
	const promptTokens = input + cacheRead + cacheWrite;
	if (promptTokens <= 0) return null;
	return (cacheRead / promptTokens) * 100;
}

/**
 * Branch-cumulative cache-hit rate.
 * Hidden until some assistant usage on the branch reported cacheRead.
 */
export function cumulativeCacheHitRate(usages: readonly PromptCacheUsage[]): number | null {
	let input = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	for (const usage of usages) {
		input += finiteOrZero(usage.input);
		cacheRead += finiteOrZero(usage.cacheRead);
		cacheWrite += finiteOrZero(usage.cacheWrite);
	}
	if (cacheRead <= 0) return null;
	return cacheHitRate({ input, cacheRead, cacheWrite });
}

export function assistantCacheUsages(
	entries: ReadonlyArray<{
		type?: string;
		message?: { role?: string; usage?: PromptCacheUsage };
	}>,
): PromptCacheUsage[] {
	const usages: PromptCacheUsage[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "assistant" || message.usage == null) continue;
		usages.push(message.usage);
	}
	return usages;
}

export function formatCacheHit(rate: number | null): string | undefined {
	if (rate == null || !Number.isFinite(rate)) return undefined;
	return `CH${rate.toFixed(1)}%`;
}

export function cacheHitTone(rate: number | null): CacheTone | undefined {
	if (rate == null || !Number.isFinite(rate)) return undefined;
	if (rate < CACHE_HIT_DANGER_PERCENT) return "error";
	if (rate < CACHE_HIT_WARN_PERCENT) return "warning";
	return "syntaxKeyword";
}

export function formatHomePath(cwd: string, home = homedir()): string {
	if (!home) return cwd;
	if (cwd === home) return "~";
	const prefix = home.endsWith("/") ? home : `${home}/`;
	if (cwd.startsWith(prefix)) return `~/${cwd.slice(prefix.length)}`;
	return cwd;
}

export function compactProjectPath(path: string): string {
	const name = basename(path.replace(/\/+$/, "")) || path;
	if (path === "~" || path === name) return path;
	return `…/${name}`;
}

export function ellipsizeMiddle(path: string, maxWidth: number): string {
	if (path.length <= maxWidth) return path;
	if (maxWidth <= 1) return "…".slice(0, maxWidth);
	const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
	const parts = path.split(sep).filter((part, i) => part.length > 0 || i === 0);
	if (parts.length <= 2) {
		const keep = Math.max(1, maxWidth - 1);
		return `…${path.slice(-keep)}`.slice(-maxWidth);
	}
	const head = parts[0]!;
	const tail = parts[parts.length - 1]!;
	const compact = `${head}${sep}…${sep}${tail}`;
	if (compact.length <= maxWidth) return compact;
	if (maxWidth <= 2) return "…".slice(0, maxWidth);
	return `…/${tail}`.length <= maxWidth ? `…/${tail}` : `…${tail.slice(-(maxWidth - 1))}`;
}

export function modelLabel(name: string | undefined, id: string | undefined): string {
	return name?.trim() || id?.trim() || UNKNOWN;
}

export function shortenModelLabel(label: string, maxWidth: number): string {
	if (label.length <= maxWidth) return label;
	const slash = label.lastIndexOf("/");
	const leaf = slash >= 0 ? label.slice(slash + 1) : label;
	if (leaf.length > 0 && leaf.length <= maxWidth) return leaf;
	if (maxWidth <= 1) return "…".slice(0, maxWidth);
	return `…${leaf.slice(-(maxWidth - 1))}`;
}

export function formatTps(tps: number | null, unit: "tok/s" | "t/s" = "tok/s"): string {
	if (tps == null || !Number.isFinite(tps)) return `${UNKNOWN} ${unit}`;
	return `${Math.round(tps)} ${unit}`;
}

export function thinkingLevelLabel(level: string | undefined): string | undefined {
	const value = level?.trim();
	if (!value || value === "off") return undefined;
	return value;
}

export function formatThinkingEffort(level: string | undefined): string | undefined {
	const label = thinkingLevelLabel(level);
	if (!label) return undefined;
	return `${label} effort`;
}

/** Same thinking-level tokens as my-pi (`status/header.ts`). */
const THINKING_LEVEL_COLORS: Record<string, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

export function thinkingThemeColor(level: string | undefined): ThemeColor {
	const value = level?.trim();
	if (!value) return "thinkingText";
	return THINKING_LEVEL_COLORS[value] ?? "thinkingText";
}

/** Header: `model · max effort`. */
export function formatModelThinking(model: string, thinking: string | undefined): string {
	const effort = formatThinkingEffort(thinking);
	if (!effort) return model;
	return `${model} · ${effort}`;
}

/** Footer: `model max` — one slot, space only. Never use ` · `; that separates slots. */
export function formatFooterModelThinking(model: string, thinking: string | undefined): string {
	const label = thinkingLevelLabel(thinking);
	if (!label) return model;
	return `${model} ${label}`;
}

export function paintModelThinking(
	model: string,
	thinking: string | undefined,
	theme: Theme,
	modelColor: ThemeColor = "muted",
): string {
	const paintedModel = theme.fg(modelColor, model);
	const label = thinkingLevelLabel(thinking);
	if (!label) return paintedModel;
	return (
		paintedModel +
		theme.fg("dim", " · ") +
		theme.fg(thinkingThemeColor(thinking), label) +
		theme.fg(modelColor, " effort")
	);
}

export function paintFooterModelThinking(model: string, thinking: string | undefined, theme: Theme): string {
	const paintedModel = theme.fg("text", model);
	const label = thinkingLevelLabel(thinking);
	if (!label) return paintedModel;
	return `${paintedModel} ${theme.fg(thinkingThemeColor(thinking), label)}`;
}

const STALE_CTX = "stale after session replacement or reload";

export function isStaleExtensionError(error: unknown): boolean {
	return error instanceof Error && error.message.includes(STALE_CTX);
}

export function fallbackIfStale<T>(run: () => T, fallback: T): T {
	try {
		return run();
	} catch (error) {
		if (isStaleExtensionError(error)) return fallback;
		throw error;
	}
}

export function sameLines(a: readonly string[] | undefined, b: readonly string[]): boolean {
	if (!a || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/** Keep the previous array reference when the painted rows did not change. */
export function internLines(cache: { lines?: string[] }, next: string[]): string[] {
	if (cache.lines && sameLines(cache.lines, next)) return cache.lines;
	cache.lines = next;
	return next;
}
