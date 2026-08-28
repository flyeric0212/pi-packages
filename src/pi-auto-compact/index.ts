import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAutoCompactLoader, type AutoCompactLoader, type LoadConfigOptions } from "./config.ts";
import {
	markNotify,
	markTriggered,
	onCompactionComplete,
	onCompactionError,
	onRearmed,
	createSessionState,
	type AutoCompactSessionState,
} from "./state.ts";
import { computeRealTotal, evaluateTrigger, type TriggerUsage } from "./trigger.ts";
import { getMessages } from "./messages.ts";

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
}

interface AssistantMessageLike {
	role: "assistant";
	stopReason?: string;
	usage?: UsageLike;
}

function isAssistantMessage(msg: unknown): msg is AssistantMessageLike {
	return typeof msg === "object" && msg !== null && (msg as { role?: unknown }).role === "assistant";
}

/** Test hook: override config file discovery (e.g. point at a temp file). */
export interface PiAutoCompactOptions {
	configPaths?: string[];
}

export default function piAutoCompactExtension(pi: ExtensionAPI, options: PiAutoCompactOptions = {}): void {
	let state: AutoCompactSessionState = createSessionState();
	let configLoader: AutoCompactLoader | null = null;
	let lastDiagnostic: string | undefined;

	function reportDiagnostic(message: string, notify: (msg: string) => void): void {
		if (message === lastDiagnostic) return;
		lastDiagnostic = message;
		notify(message);
	}

	function loaderOptions(ctx: ExtensionContext): LoadConfigOptions {
		return {
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
			...(options.configPaths ? { paths: options.configPaths } : {}),
			onDiagnostic(message) {
				reportDiagnostic(message, (msg) => {
					if (ctx.hasUI) ctx.ui.notify(msg, "warning");
					else console.error(`[pi-auto-compact] ${msg}`);
				});
			},
		};
	}

	pi.on("session_start", (_event, ctx) => {
		state = createSessionState();
		lastDiagnostic = undefined;
		configLoader = createAutoCompactLoader(loaderOptions(ctx));
	});

	// Cancel pi's own threshold compaction only while ours is in flight, to
	// prevent a double compaction. In every other state — idle-but-healthy,
	// notifyOnly, disarmed after failures, or session-disabled — pi's native
	// threshold compaction stays as the safety net (its success resets our
	// failure state via session_compact). Manual /compact and overflow
	// recovery are never touched either way.
	pi.on("session_before_compact", (event) => {
		if (event.reason === "threshold" && state.compacting) {
			return { cancel: true };
		}
	});

	// Manual / overflow compactions reset failure counters and state cleanly.
	pi.on("session_compact", (event) => {
		if (event.reason === "manual" || event.reason === "overflow") {
			state = onCompactionComplete(state);
		}
	});

	// Mid-turn tracking, plus the mid-turn trigger when interruptTurn=true.
	// Aborted/error messages must never trigger an automatic compact+resume:
	// the user may be deliberately stopping. Length stops are reserved for
	// Pi's native overflow recovery so the two compaction flows cannot race.
	pi.on("message_end", (event, ctx) => {
		const msg = event.message;
		if (!isAssistantMessage(msg)) return;
		if (msg.stopReason === "aborted" || msg.stopReason === "error" || msg.stopReason === "length") return;
		const realTotal = computeRealTotal(msg.usage);
		if (realTotal != null) state = { ...state, realTotal };
		if (!configLoader?.get().autoCompact.interruptTurn) return;
		checkAndAct(ctx);
	});

	// Turn-boundary trigger when interruptTurn=false. Note: `turn_end` fires
	// after EVERY assistant message (including mid-loop tool steps), so the
	// only true turn-end signal is `agent_end`.
	pi.on("agent_end", (event, ctx) => {
		if (configLoader?.get().autoCompact.interruptTurn) return;
		let lastAssistant: AssistantMessageLike | undefined;
		for (let i = event.messages.length - 1; i >= 0; i--) {
			const m = event.messages[i];
			if (m && isAssistantMessage(m)) {
				lastAssistant = m;
				break;
			}
		}
		if (!lastAssistant) return;
		if (
			lastAssistant.stopReason === "aborted" ||
			lastAssistant.stopReason === "error" ||
			lastAssistant.stopReason === "length"
		) {
			return;
		}
		checkAndAct(ctx);
	});

	// Tree navigation changes the active branch in-place. Session switches and
	// forks are cleaned up by session_shutdown and initialized by session_start;
	// do not reset in cancellable `session_before_*` hooks.
	pi.on("session_tree", () => {
		state = createSessionState();
	});
	// Model switches change the context window; the tracked real total belongs
	// to the previous model's window and must not judge the new one.
	pi.on("model_select", () => {
		state = { ...state, realTotal: null };
	});

	pi.on("session_shutdown", () => {
		state = createSessionState();
		configLoader = null;
	});

	function checkAndAct(ctx: ExtensionContext): void {
		const config = configLoader?.get();
		if (!config) return;
		const messages = getMessages(config.autoCompact.lang);

		const usage = ctx.getContextUsage();
		const contextWindow = ctx.model?.contextWindow ?? usage?.contextWindow ?? 0;
		const snapshot: TriggerUsage | undefined = usage
			? { tokens: usage.tokens, percent: usage.percent, contextWindow }
			: undefined;

		const decision = evaluateTrigger({ config, state, usage: snapshot });

		if (decision.gate === "below-percent" || decision.gate === "rearmed") {
			state = onRearmed(state);
			return;
		}
		if (decision.action === "none") return;

		if (decision.action === "notify") {
			if (ctx.hasUI) {
				ctx.ui.notify(messages.notifySuggestCompact(Math.round(decision.realPct ?? 0)), "warning");
			}
			state = markNotify(state, decision.tokens ?? 0);
			return;
		}

		// Compact and resume automatically.
		state = markTriggered(state, decision.tokens ?? 0);
		if (ctx.hasUI) {
			ctx.ui.notify(messages.notifyCompacting(Math.round(decision.realPct ?? 0)), "info");
		}

		ctx.compact({
			customInstructions: config.autoCompact.customInstructions,
			onComplete: () => {
				// pi invokes onError when onComplete throws; the compaction itself
				// succeeded, so never let a presentation error look like a failure.
				try {
					state = onCompactionComplete(state);
					if (ctx.hasUI) ctx.ui.notify(messages.notifyResumed, "info");
					// If the user (or another extension) already queued input while
					// we were compacting, don't stack our resume prompt on top of it.
					if (!ctx.hasPendingMessages()) {
						pi.sendUserMessage(messages.resumePrompt);
					}
				} catch {
					state = onCompactionComplete(state);
				}
			},
			onError: (error: Error) => {
				state = onCompactionError(state);
				if (ctx.hasUI) {
					ctx.ui.notify(messages.notifyFailed(error.message, state.disabled), "error");
				}
			},
		});
	}
}