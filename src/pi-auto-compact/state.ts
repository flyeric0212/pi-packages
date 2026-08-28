/** Per-session state; created lazily and fully discarded on session shutdown. */
export interface AutoCompactSessionState {
	/** A compaction (or resume) is in flight; suppress further triggers. */
	compacting: boolean;
	/** Context tokens when the last auto-compaction (or notify mark) happened. */
	lastCompactTokens: number;
	/** Consecutive auto-compaction failures; reaching the max disables the session. */
	consecutiveFailures: number;
	/** Disarmed after a failure until context drops back below the threshold. */
	failed: boolean;
	/** Session permanently disabled after too many consecutive failures. */
	disabled: boolean;
	/** Real context tokens (native totalTokens or input+output+cacheRead+cacheWrite) from the last assistant message. */
	realTotal: number | null;
}

export const MAX_CONSECUTIVE_FAILURES = 3;

export function createSessionState(): AutoCompactSessionState {
	return {
		compacting: false,
		lastCompactTokens: 0,
		consecutiveFailures: 0,
		failed: false,
		disabled: false,
		realTotal: null,
	};
}

/** Mark that auto-compaction was triggered; records the debounce baseline. */
export function markTriggered(state: AutoCompactSessionState, tokens: number): AutoCompactSessionState {
	return { ...state, compacting: true, lastCompactTokens: tokens };
}

/** notifyOnly mode: record the notified point as the debounce baseline (no compaction). */
export function markNotify(state: AutoCompactSessionState, tokens: number): AutoCompactSessionState {
	return { ...state, lastCompactTokens: tokens };
}

/** Compaction succeeded: clear the in-flight flag and reset failure counters. */
export function onCompactionComplete(state: AutoCompactSessionState): AutoCompactSessionState {
	return {
		...state,
		compacting: false,
		consecutiveFailures: 0,
		failed: false,
		realTotal: null,
	};
}

/** Compaction failed: disarm until context drops below the threshold; disable after 3 consecutive failures. */
export function onCompactionError(state: AutoCompactSessionState): AutoCompactSessionState {
	const consecutiveFailures = state.consecutiveFailures + 1;
	return {
		...state,
		compacting: false,
		failed: true,
		consecutiveFailures,
		disabled: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
	};
}

/** Re-arm after a failure or when context dropped back below the threshold. */
export function onRearmed(state: AutoCompactSessionState): AutoCompactSessionState {
	return { ...state, failed: false, lastCompactTokens: 0 };
}