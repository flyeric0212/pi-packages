import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_TRIGGER_PERCENT, loadTriggerPercent } from "./config.ts";

interface AssistantMessageLike {
	role: "assistant";
	stopReason?: string;
}

const SKIPPED_STOP_REASONS = new Set(["aborted", "error", "length"]);

/** Keep Pi's native structured summary focused without exposing another setting. */
const QUALITY_INSTRUCTIONS =
	"Preserve the current goal and acceptance criteria, unfinished work with exact file paths, " +
	"key decisions with rationale, concrete next steps, and complete <read-files>/<modified-files> lists. " +
	"Prioritize facts needed to continue safely; omit redundant narration.";

function isAssistantMessage(message: unknown): message is AssistantMessageLike {
	return typeof message === "object" && message !== null && (message as { role?: unknown }).role === "assistant";
}

/** Test hook: override config discovery. */
export interface PiAutoCompactOptions {
	configPaths?: string[];
}

/**
 * Pi 0.84.4 owns active-run threshold and overflow compaction. This extension
 * adds only a model-relative budget check after the run has fully settled.
 */
export default function piAutoCompactExtension(pi: ExtensionAPI, options: PiAutoCompactOptions = {}): void {
	let triggerPercent = DEFAULT_TRIGGER_PERCENT;
	let finalStopReason: string | undefined;
	let compacting = false;
	let disabledAfterFailure = false;

	pi.on("session_start", (_event, ctx) => {
		finalStopReason = undefined;
		compacting = false;
		disabledAfterFailure = false;
		triggerPercent = loadTriggerPercent({
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
			...(options.configPaths ? { paths: options.configPaths } : {}),
			onDiagnostic(message) {
				if (ctx.hasUI) ctx.ui.notify(message, "warning");
				else console.error(`[pi-auto-compact] ${message}`);
			},
		});
	});

	// agent_settled has no message payload, so retain only the final outcome.
	pi.on("agent_start", () => {
		finalStopReason = undefined;
	});
	pi.on("agent_end", (event) => {
		for (let index = event.messages.length - 1; index >= 0; index--) {
			const message = event.messages[index];
			if (message && isAssistantMessage(message)) {
				finalStopReason = message.stopReason;
				break;
			}
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (compacting || disabledAfterFailure) return;
		if (finalStopReason === undefined || SKIPPED_STOP_REASONS.has(finalStopReason)) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

		const usage = ctx.getContextUsage();
		const contextWindow = ctx.model?.contextWindow ?? usage?.contextWindow ?? 0;
		if (usage?.tokens == null || contextWindow <= 0) return;
		if ((usage.tokens / contextWindow) * 100 < triggerPercent) return;

		compacting = true;
		ctx.compact({ customInstructions: QUALITY_INSTRUCTIONS });
	});

	// "manual" is shared by /compact, RPC, and extension calls; the local flag
	// associates only the request started above with these official outcomes.
	pi.on("session_compact", (event) => {
		if (compacting && event.reason === "manual") compacting = false;
	});
	pi.on("session_compact_failed", (event, ctx) => {
		if (!compacting || event.reason !== "manual") return;
		compacting = false;
		disabledAfterFailure = true;
		if (!event.aborted && ctx.hasUI) {
			ctx.ui.notify(
				`Auto-compact failed: ${event.errorMessage ?? "unknown error"}. Disabled for this session; Pi native compaction remains active.`,
				"error",
			);
		}
	});

	pi.on("session_shutdown", () => {
		finalStopReason = undefined;
		compacting = false;
		disabledAfterFailure = false;
	});
}
