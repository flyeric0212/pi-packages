import { COLLAPSED_PREVIEW_LINES } from "../config.ts";

export type PreviewTake = "head" | "tail";
export type PreviewTone = "toolOutput" | "error";

export type PreviewTheme = {
	fg(color: string, text: string): string;
};

export type CollapsedPreview = {
	shown: string[];
	remaining: number;
};

export function splitPreviewLines(text: string): string[] {
	const lines = text.replace(/\r/g, "").split("\n");
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") end -= 1;
	return lines.slice(0, end);
}

export function collapsePreviewLines(
	text: string,
	take: PreviewTake,
	limit = COLLAPSED_PREVIEW_LINES,
): CollapsedPreview {
	const lines = splitPreviewLines(text);
	const max = Math.max(0, limit);
	if (lines.length <= max) return { shown: lines, remaining: 0 };
	const shown = take === "tail" ? lines.slice(-max) : lines.slice(0, max);
	return { shown, remaining: lines.length - shown.length };
}

export function formatCollapsedPreview(
	preview: CollapsedPreview,
	theme: PreviewTheme,
	tone: PreviewTone,
	expandHint: string,
): string {
	const body = preview.shown.map((line) => theme.fg(tone, line)).join("\n");
	let text = body.length > 0 ? `\n${body}` : "";
	if (preview.remaining > 0) {
		const unit = preview.remaining === 1 ? "line" : "lines";
		text += `\n${theme.fg("muted", `... (${preview.remaining} more ${unit},`)} ${expandHint}${theme.fg("muted", ")")}`;
	}
	return text;
}

export function resultText(result: { content?: Array<{ type: string; text?: string }> } | undefined): string {
	if (!result?.content) return "";
	return result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");
}
