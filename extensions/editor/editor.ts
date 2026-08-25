import { PROMPT_CHAR, PROMPT_LEFT_PAD, PROMPT_GUTTER_COLS } from "../config.ts";
import { sliceByColumn, truncateToWidth, visibleWidth, type AutocompleteItem, type AutocompleteProvider, type Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { buildSkillCatalog, type SkillCatalog } from "../catalog.ts";
import { colorizeLeadingCommand, recognizedLeadingCommand } from "./command-paint.ts";

const RESET_BG = "\x1b[49m";
const BORDER_GLYPH = "─";

export { PROMPT_CHAR };

export function isBashInput(text: string): boolean {
	return text.trimStart().startsWith("!");
}

const MARKDOWN_BLOCK_START = /^(```|~~~|# |>|[-*+] |\d+\.\s)/;

/** Display-only prefix for historical user messages. Idempotent. */
export function prefixUserPrompt(markdown: string, prompt = PROMPT_CHAR): string {
	const text = markdown.replace(/^\uFEFF/, "");
	const body = text.trimStart();
	if (body.startsWith(prompt)) return markdown;
	if (body.length === 0) return prompt;
	if (MARKDOWN_BLOCK_START.test(body)) return `${prompt}\n\n${text}`;
	return `${prompt} ${text}`;
}

export function findBottomBorderIndex(lines: readonly string[]): number {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i]?.includes(BORDER_GLYPH)) return i;
	}
	return Math.max(0, lines.length - 1);
}

export type EditorChromeLayout = {
	contentIndex: number;
	bottomIndex: number;
};

/** Locate the Codex panel. Missing chrome (no bottom border) means leave Pi's lines alone. */
export function inspectEditorChrome(lines: readonly string[]): EditorChromeLayout | undefined {
	if (lines.length < 2) return undefined;
	let bottom = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i]?.includes(BORDER_GLYPH)) {
			bottom = i;
			break;
		}
	}
	if (bottom < 1) return undefined;
	return { contentIndex: 1, bottomIndex: bottom };
}

export function replaceBorderGlyphs(line: string): string {
	return line.replaceAll(BORDER_GLYPH, " ");
}

export function insertPrompt(line: string, prompt: string, leftPad = PROMPT_LEFT_PAD): string {
	const width = visibleWidth(line);
	const padded = width >= leftPad ? line : " ".repeat(leftPad - width) + line;
	return " ".repeat(leftPad) + prompt + sliceByColumn(padded, leftPad, Math.max(0, visibleWidth(padded) - leftPad));
}

export function fillRow(line: string, width: number, bg: string, measure: (text: string) => number = visibleWidth): string {
	let fitted = line;
	const current = measure(line);
	if (current > width) fitted = truncateToWidth(line, width, "");
	else if (current < width) fitted = `${line}${" ".repeat(width - current)}`;
	if (bg === "" || bg === RESET_BG) return fitted;
	const withBg = fitted.replace(/\x1b\[0m/g, `\x1b[0m${bg}`);
	return `${bg}${withBg}${RESET_BG}`;
}

export function isEmptyBackground(bg: string): boolean {
	return bg === "" || bg === RESET_BG;
}

/** Editor fields Tab already uses to accept a completion. Not part of the public Editor API. */
type AutocompleteHost = {
	autocompletePrefix?: string;
	autocompleteList?: { getSelectedItem(): AutocompleteItem | null };
	autocompleteProvider?: AutocompleteProvider;
};

export function typedSlashName(prefix: string): string | undefined {
	if (!prefix.startsWith("/") || prefix.includes(" ")) return undefined;
	return prefix.slice(1);
}

/** True when Enter should behave like Tab: insert the pick, do not submit. */
export function shouldAcceptSlashCompletionOnly(prefix: string, selectedValue: string): boolean {
	const typed = typedSlashName(prefix);
	if (typed === undefined) return false;
	return typed !== selectedValue;
}

export function slashAutocompleteSelection(editor: Editor): { prefix: string; value: string } | undefined {
	try {
		if (!editor.isShowingAutocomplete()) return undefined;
		const host = editor as unknown as AutocompleteHost;
		const prefix = host.autocompletePrefix;
		const value = host.autocompleteList?.getSelectedItem()?.value;
		if (typeof prefix !== "string" || typeof value !== "string" || value.length === 0) return undefined;
		if (!prefix.startsWith("/")) return undefined;
		return { prefix, value };
	} catch {
		return undefined;
	}
}

const FG_RESET = "\x1b[39m";

export type CraftEditorPaint = {
	width: number;
	text: string;
	bg: string;
	prompt: string;
	command?: string;
	accent: string;
};

/** Paint Codex chrome onto a native Editor frame. Unknown layouts pass through. */
export function paintCraftEditor(lines: readonly string[], paint: CraftEditorPaint): string[] {
	const layout = inspectEditorChrome(lines);
	if (!layout) return lines.map((line) => truncateToWidth(line, paint.width, ""));

	const next = lines.slice();
	if (paint.command) {
		next[layout.contentIndex] = colorizeLeadingCommand(
			next[layout.contentIndex] ?? "",
			paint.command,
			paint.accent,
			FG_RESET,
		);
	}
	next[layout.contentIndex] = insertPrompt(next[layout.contentIndex] ?? "", paint.prompt);
	for (let i = 0; i <= layout.bottomIndex; i++) {
		const stripped = replaceBorderGlyphs(next[i] ?? "");
		next[i] = isEmptyBackground(paint.bg) ? stripped : fillRow(stripped, paint.width, paint.bg);
	}
	return next.map((line) => truncateToWidth(line, paint.width, ""));
}

export class CraftEditor extends CustomEditor {
	private readonly piTheme: Theme;
	private readonly catalog: () => SkillCatalog;
	private readonly keys: KeybindingsManager;

	constructor(
		tui: TUI,
		editorTheme: EditorTheme,
		keybindings: KeybindingsManager,
		piTheme: Theme,
		catalog: () => SkillCatalog,
	) {
		super(tui, editorTheme, keybindings, { paddingX: PROMPT_GUTTER_COLS });
		this.piTheme = piTheme;
		this.catalog = catalog;
		this.keys = keybindings;
	}

	override handleInput(data: string): void {
		if (this.shouldCompleteSlashWithoutSubmit(data)) {
			super.handleInput("\t");
			return;
		}
		super.handleInput(data);
	}

	private shouldCompleteSlashWithoutSubmit(data: string): boolean {
		if (!this.keys.matches(data, "tui.select.confirm")) return false;
		if (!this.keys.matches("\t", "tui.input.tab")) return false;
		const selection = slashAutocompleteSelection(this);
		if (!selection) return false;
		return shouldAcceptSlashCompletionOnly(selection.prefix, selection.value);
	}

	override setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(PROMPT_GUTTER_COLS, padding));
	}

	override render(width: number): string[] {
		const text = this.getText();
		return paintCraftEditor(super.render(width), {
			width,
			text,
			bg: this.piTheme.getBgAnsi("userMessageBg"),
			prompt: isBashInput(text)
				? this.piTheme.fg("bashMode", this.piTheme.bold(PROMPT_CHAR))
				: this.piTheme.bold(PROMPT_CHAR),
			command: recognizedLeadingCommand(text, this.catalog()),
			accent: this.piTheme.getFgAnsi("accent"),
		});
	}
}

export function installEditor(ctx: ExtensionContext, pi: ExtensionAPI): void {
	const theme = ctx.ui.theme;
	ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
		return new CraftEditor(tui, editorTheme, keybindings, theme, () => buildSkillCatalog(pi.getCommands()));
	});
}
