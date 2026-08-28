/** All user-facing copy in one place: resume prompt + UI notifications, localized. */

export type MessageLang = "zh" | "en";

export interface AutoCompactMessages {
	/** Injected as a user message after an auto-compaction to resume the task. */
	resumePrompt: string;
	/** Shown when an auto-compaction starts. */
	notifyCompacting(pct: number): string;
	/** Shown when an auto-compaction completed and the task was resumed. */
	notifyResumed: string;
	/** Shown when an auto-compaction fails; `disabled` marks the session-level stop. */
	notifyFailed(errorMessage: string, disabled: boolean): string;
	/** Shown in notifyOnly mode when the threshold is reached. */
	notifySuggestCompact(pct: number): string;
}

const ZH: AutoCompactMessages = {
	resumePrompt:
		"上下文已自动压缩。请审查上方摘要，按其 Next Steps 继续当前任务；" +
		"若任务已完成，简短确认即可，不要开始新工作。",
	notifyCompacting: (pct) => `上下文已达 ${pct}%，自动压缩中…`,
	notifyResumed: "自动压缩完成，已自动继续任务",
	notifyFailed: (errorMessage, disabled) =>
		`自动压缩失败：${errorMessage}${disabled ? "（连续失败，本会话已停止自动压缩）" : "（上下文回落后再试）"}`,
	notifySuggestCompact: (pct) => `上下文已达 ${pct}%，建议执行 /compact 压缩后再继续`,
};

const EN: AutoCompactMessages = {
	resumePrompt:
		"Context was auto-compacted. Review the summary above and continue the " +
		"in-progress task following its Next Steps; if the task is already done, " +
		"briefly confirm instead of starting new work.",
	notifyCompacting: (pct) => `Context at ${pct}% — compacting…`,
	notifyResumed: "Auto-compacted, resumed",
	notifyFailed: (errorMessage, disabled) =>
		`Auto-compact failed: ${errorMessage}${disabled ? " (session auto-compact disabled)" : " (will retry after context drops)"}`,
	notifySuggestCompact: (pct) => `Context at ${pct}% — run /compact to continue`,
};

export function getMessages(lang: MessageLang): AutoCompactMessages {
	return lang === "en" ? EN : ZH;
}