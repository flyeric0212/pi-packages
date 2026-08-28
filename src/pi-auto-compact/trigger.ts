import type { AutoCompactConfig } from "./config.ts";
import type { AutoCompactSessionState } from "./state.ts";

/** Snapshot sufficient for a trigger decision (ctx.getContextUsage(), window from model). */
export interface TriggerUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export type TriggerAction = "none" | "notify" | "compact";

export type TriggerGate =
	| "config-disabled"
	| "session-disabled"
	| "no-usage"
	| "compacting"
	| "disarmed"
	| "rearmed"
	| "below-percent"
	| "debounce"
	| "ok";

export interface TriggerDecision {
	action: TriggerAction;
	/** Effective percentage used for the threshold comparison (real total when known). */
	realPct: number | null;
	/** Effective context tokens used for the gates (real total when known). */
	tokens: number | null;
	gate: TriggerGate;
}

/**
 * Real context tokens reported for a completed request. Match Pi's native
 * compaction accounting: prefer totalTokens, otherwise sum prompt/cache and
 * assistant output. usage.input alone excludes cache hits, while omitting
 * output undercounts the context immediately after an assistant response.
 */
export function computeRealTotal(
	usage:
		| { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number }
		| null
		| undefined,
): number | null {
	if (!usage) return null;
	if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens) && usage.totalTokens > 0) {
		return usage.totalTokens;
	}
	const total = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
	return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Pure trigger decision machine. Order matters: fail-safe gates first,
 * thresholds second, and the debounce/disarm gates last.
 *
 * When the real total is known it drives both the percentage and the token
 * gates; otherwise pi's estimate is used (and only when it is non-null).
 */
export function evaluateTrigger(options: {
	config: AutoCompactConfig;
	state: AutoCompactSessionState;
	usage: TriggerUsage | undefined;
}): TriggerDecision {
	const { config, state, usage } = options;
	const settings = config.autoCompact;
	const none = (gate: TriggerGate): TriggerDecision => ({ action: "none", realPct: null, tokens: null, gate });

	if (!settings.enabled) return none("config-disabled");
	if (state.disabled) return none("session-disabled");
	if (!usage || usage.contextWindow <= 0) return none("no-usage");
	if (state.compacting) return none("compacting");

	// The real total (last request's full input) takes precedence over pi's
	// estimate; when it is known the estimate fields may be stale or null.
	const realTotal = state.realTotal;
	const tokens = realTotal ?? usage.tokens;
	const realPct = realTotal != null ? (realTotal / usage.contextWindow) * 100 : usage.percent;
	if (tokens == null || realPct == null) return none("no-usage");

	// Disarm gate: after a failure, only re-arm once context dropped back below the threshold.
	if (state.failed) {
		if (realPct < settings.triggerPercent) {
			return { action: "none", realPct, tokens, gate: "rearmed" };
		}
		return { action: "none", realPct, tokens, gate: "disarmed" };
	}

	if (realPct < settings.triggerPercent) return { action: "none", realPct, tokens, gate: "below-percent" };
	if (state.lastCompactTokens > 0 && tokens - state.lastCompactTokens < settings.debounceTokens) {
		return { action: "none", realPct, tokens, gate: "debounce" };
	}

	if (settings.notifyOnly) return { action: "notify", realPct, tokens, gate: "ok" };
	return { action: "compact", realPct, tokens, gate: "ok" };
}