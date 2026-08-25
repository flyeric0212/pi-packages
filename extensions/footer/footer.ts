import { type Theme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CHROME_LEFT_PAD, FOOTER_SEPARATOR, STATUS_SEPARATOR } from "../config.ts";
import {
	assistantCacheUsages,
	cacheHitTone,
	compactProjectPath,
	contextTone,
	ellipsizeMiddle,
	fallbackIfStale,
	finiteOrZero,
	formatCacheHit,
	formatContextUsage,
	formatFooterModelThinking,
	formatHomePath,
	formatTps,
	internLines,
	isStaleExtensionError,
	cumulativeCacheHitRate,
	modelLabel,
	paintFooterModelThinking,
	shortenModelLabel,
	thinkingLevelLabel,
	type CacheTone,
	type ContextTone,
} from "../utils.ts";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type CraftStore } from "../state.ts";

export type FooterFields = {
	modelName?: string;
	modelId?: string;
	thinking?: string;
	usedTokens: number | null;
	contextWindow: number | null;
	percent: number | null;
	cwd: string;
	tps: number | null;
	cacheHit: number | null;
};

type LeafMessage = {
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

export type LeafFacts = {
	leafId: string | null;
	entry?: { id?: string; message?: LeafMessage };
};

type LeafManager = {
	getLeafId(): string | null;
	getLeafEntry(): { id?: string; message?: LeafMessage } | undefined;
};

/**
 * The session branch is append-only: the leaf id plus the streaming tail's own
 * state fingerprint what the expensive branch facts (`getContextUsage`, the
 * cumulative cache-hit scan) can possibly depend on. Same as the clear view's
 * leaf-id memo, but the tail fingerprint also covers in-place growth of the
 * message currently streaming.
 */
export function readLeafFacts(manager: LeafManager | undefined): LeafFacts | undefined {
	if (!manager) return undefined;
	try {
		return { leafId: manager.getLeafId(), entry: manager.getLeafEntry() };
	} catch (error) {
		if (isStaleExtensionError(error)) return undefined;
		throw error;
	}
}

function usageValues(usage: LeafMessage["usage"]): string {
	if (!usage) return "none";
	return [
		finiteOrZero(usage.input),
		finiteOrZero(usage.output),
		finiteOrZero(usage.cacheRead),
		finiteOrZero(usage.cacheWrite),
		finiteOrZero(usage.reasoning),
		finiteOrZero(usage.totalTokens),
	].join(":");
}

/**
 * Chars in the leaf content that Pi's `estimateTokens` counts for an assistant
 * tail: text, thinking, and toolCall name + serialized arguments. The context
 * estimate is `ceil(chars / 4)`, so same chars ⇒ same estimate; any tail growth
 * (including thinking and tool calls) must change this value.
 */
export function tailEstimateChars(content: unknown): number {
	if (!Array.isArray(content)) return 0;
	let chars = 0;
	for (const block of content) {
		if (block == null || typeof block !== "object") continue;
		const any = block as Record<string, unknown>;
		if (any.type === "text" && typeof any.text === "string") {
			chars += any.text.length;
		} else if (any.type === "thinking" && typeof any.thinking === "string") {
			chars += any.thinking.length;
		} else if (any.type === "toolCall") {
			if (typeof any.name === "string") chars += any.name.length;
			if (any.arguments !== undefined) {
				try {
					const serialized = JSON.stringify(any.arguments);
					if (serialized) chars += serialized.length;
				} catch {
					// Non-serializable arguments: nothing safe to count.
				}
			}
		}
	}
	return chars;
}

/**
 * Cache-hit rate depends only on the branch shape and the prompt-cache fields
 * of the streaming tail. Output tokens and text growth do not change it, so
 * streaming frames hit the memo instead of rescanning the branch.
 */
export function cacheHitMemoKey(facts: LeafFacts | undefined): string | undefined {
	if (!facts) return undefined;
	const usage = facts.entry?.message?.usage;
	const key = [facts.leafId ?? "", usage ? finiteOrZero(usage.input) : "", usage ? finiteOrZero(usage.cacheRead) : "", usage ? finiteOrZero(usage.cacheWrite) : ""].join("|");
	return key;
}

/**
 * Context estimate depends on the whole tail: model, usage (all fields the
 * estimate reads, including reasoning and totalTokens), and every char Pi's
 * `estimateTokens` would count (text, thinking, toolCall). Any tail growth
 * must change this key.
 */
export function contextMemoKey(facts: LeafFacts | undefined, modelId: string | undefined): string | undefined {
	if (!facts) return undefined;
	const message = facts.entry?.message;
	const usage = message?.usage;
	const key = [
		facts.leafId ?? "",
		modelId ?? "",
		message?.role ?? "",
		usage ? usageValues(usage) : "none",
		tailEstimateChars(message?.content),
	].join("|");
	return key;
}

/**
 * Value memo keyed by an optional fingerprint; `undefined` key never caches.
 * A computed `undefined` value is still cached (a fingerprint match means the
 * value cannot have changed, whatever it is).
 */
export class Memo<T> {
	private key: string | undefined;
	private hasValue = false;
	private value: T | undefined;

	get(key: string | undefined, compute: () => T): T {
		if (key !== undefined && this.hasValue && this.key === key) return this.value as T;
		const next = compute();
		this.key = key;
		this.value = next;
		this.hasValue = true;
		return next;
	}
}

export type FittedFooter = {
	model: string;
	thinking: string;
	context: string;
	cwd: string | undefined;
	tps: string | undefined;
	cache: string | undefined;
	tone: ContextTone;
	cacheTone: CacheTone | undefined;
};

/** `modelThinking` is one slot (`model high`); do not split it with the line separator. */
export const FOOTER_SLOT_ORDER = ["modelThinking", "context", "cwd", "tps", "cache"] as const;
export type FooterSlotId = (typeof FOOTER_SLOT_ORDER)[number];

export function footerSlotText(fitted: FittedFooter): Record<FooterSlotId, string | undefined> {
	return {
		modelThinking: formatFooterModelThinking(fitted.model, fitted.thinking),
		context: fitted.context,
		cwd: fitted.cwd,
		tps: fitted.tps,
		cache: fitted.cache,
	};
}

function joinPlain(parts: Array<string | undefined>, sep = FOOTER_SEPARATOR): string {
	return parts.filter((part): part is string => Boolean(part && part.length > 0)).join(sep);
}

function joinFitted(fitted: FittedFooter, sep = FOOTER_SEPARATOR): string {
	const slots = footerSlotText(fitted);
	return joinPlain(
		FOOTER_SLOT_ORDER.map((id) => slots[id]),
		sep,
	);
}

export function fitFooter(fields: FooterFields, width: number, home?: string): FittedFooter {
	const thinking = fields.thinking?.trim() ?? "";
	const fullModel = modelLabel(fields.modelName, fields.modelId);
	const context = formatContextUsage(fields.usedTokens, fields.contextWindow);
	const fullCwd = formatHomePath(fields.cwd, home);
	const compactCwd = compactProjectPath(fullCwd);
	const tone = contextTone(fields.percent);
	const cache = formatCacheHit(fields.cacheHit);
	const cacheTone = cacheHitTone(fields.cacheHit);
	const cacheWidth = cache ? visibleWidth(`${FOOTER_SEPARATOR}${cache}`) : 0;

	const attempt = (
		model: string,
		cwd: string | undefined,
		tps: string | undefined,
		shownCache: string | undefined = cache,
	): { line: string; fitted: FittedFooter } => {
		const fitted: FittedFooter = {
			model,
			thinking,
			context,
			cwd,
			tps,
			cache: shownCache,
			tone,
			cacheTone: shownCache ? cacheTone : undefined,
		};
		return { line: joinFitted(fitted), fitted };
	};

	const fullTps = formatTps(fields.tps, "tok/s");
	const shortTps = formatTps(fields.tps, "t/s");

	const steps: Array<() => ReturnType<typeof attempt>> = [
		() => attempt(fullModel, fullCwd, fullTps),
		() => attempt(fullModel, ellipsizeMiddle(fullCwd, Math.max(compactCwd.length, Math.min(fullCwd.length, 24))), fullTps),
		() => attempt(fullModel, compactCwd, fullTps),
		() => {
			const rest = joinPlain([context, compactCwd, fullTps, cache]);
			const label = thinkingLevelLabel(thinking);
			const reserved = visibleWidth(
				(label ? ` ${label}` : "") + (rest ? `${FOOTER_SEPARATOR}${rest}` : ""),
			);
			const modelWidth = Math.max(4, width - reserved);
			return attempt(shortenModelLabel(fullModel, modelWidth), compactCwd, fullTps);
		},
		() => attempt(shortenModelLabel(fullModel, Math.max(4, width - 24 - cacheWidth)), compactCwd, shortTps),
		() => attempt(shortenModelLabel(fullModel, Math.max(4, width - 16 - cacheWidth)), undefined, shortTps),
		() => attempt(shortenModelLabel(fullModel, Math.max(4, width - 10 - cacheWidth)), undefined, undefined),
		() => attempt(shortenModelLabel(fullModel, Math.max(4, width - 10)), undefined, undefined, undefined),
	];

	let chosen = steps[0]!();
	for (const step of steps) {
		chosen = step();
		if (visibleWidth(chosen.line) <= width) return chosen.fitted;
	}

	const core = joinFitted({ ...chosen.fitted, cwd: undefined, tps: undefined, cache: undefined });
	if (visibleWidth(core) <= width) return chosen.fitted;
	return {
		...chosen.fitted,
		model: shortenModelLabel(fullModel, Math.max(1, width - visibleWidth(context) - 3)),
		cwd: undefined,
		tps: undefined,
		cache: undefined,
		cacheTone: undefined,
	};
}

export function formatStatusLine(texts: readonly string[], width: number): string | undefined {
	const items = texts.map((text) => text.trim()).filter((text) => text.length > 0);
	if (items.length === 0) return undefined;
	return truncateToWidth(items.join(STATUS_SEPARATOR), width, "…");
}

export function renderFooter(
	fields: FooterFields,
	statuses: readonly string[],
	width: number,
	theme: Theme,
	home?: string,
): string[] {
	const pad = " ".repeat(CHROME_LEFT_PAD);
	const inner = Math.max(0, width - CHROME_LEFT_PAD);
	const metrics = pad + truncateToWidth(paintFooter(fitFooter(fields, inner, home), theme), inner, "");
	const status = formatStatusLine(statuses, inner);
	const lines = status ? [pad + status, metrics] : [metrics];
	return lines.map((line) => truncateToWidth(line, width, ""));
}

export function paintFooter(fitted: FittedFooter, theme: Theme): string {
	const sep = theme.fg("dim", FOOTER_SEPARATOR.trim());
	const slots: Record<FooterSlotId, string | undefined> = {
		modelThinking: paintFooterModelThinking(fitted.model, fitted.thinking, theme),
		context: theme.fg(fitted.tone, fitted.context),
		cwd: fitted.cwd ? theme.fg("text", fitted.cwd) : undefined,
		tps: fitted.tps ? theme.fg("accent", fitted.tps) : undefined,
		cache: fitted.cache && fitted.cacheTone ? theme.fg(fitted.cacheTone, fitted.cache) : undefined,
	};
	return FOOTER_SLOT_ORDER.map((id) => slots[id]).filter((part): part is string => Boolean(part)).join(` ${sep} `);
}

export function installFooter(ctx: ExtensionContext, store: CraftStore): void {
	ctx.ui.setFooter((tui, _theme, footerData) => {
		const cache: { lines?: string[] } = {};
		const cacheHitMemo = new Memo<number | null>();
		const contextMemo = new Memo<ReturnType<ExtensionContext["getContextUsage"]>>();
		const unsubscribe = store.subscribe(() => tui.requestRender());
		return {
			dispose: unsubscribe,
			invalidate() {
				cache.lines = undefined;
			},
			render(width: number): string[] {
				return internLines(
					cache,
					fallbackIfStale(() => {
						const snap = store.snapshot;
						const leaf = readLeafFacts(ctx.sessionManager);
						const cacheHit = cacheHitMemo.get(
							cacheHitMemoKey(leaf),
							() => cumulativeCacheHitRate(assistantCacheUsages(ctx.sessionManager.getBranch())),
						);
						const usage = contextMemo.get(contextMemoKey(leaf, ctx.model?.id), () => ctx.getContextUsage());
						return renderFooter(
							{
								modelName: ctx.model?.name ?? snap.modelName,
								modelId: ctx.model?.id ?? snap.modelId,
								thinking: ctx.thinkingLevel ?? snap.thinking,
								usedTokens: usage?.tokens ?? null,
								contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
								percent: usage?.percent ?? null,
								cwd: ctx.cwd || snap.cwd,
								tps: snap.tps.tps,
								cacheHit,
							},
							[...footerData.getExtensionStatuses().values()],
							width,
							ctx.ui.theme,
						);
					}, []),
				);
			},
		};
	});
}
