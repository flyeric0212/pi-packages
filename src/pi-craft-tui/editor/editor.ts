import { PROMPT_CHAR, PROMPT_LEFT_PAD, PROMPT_GUTTER_COLS } from "../config.ts";
import { sliceByColumn, truncateToWidth, visibleWidth, type AutocompleteItem, type AutocompleteProvider, type Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import type { SkillCatalog } from "../catalog.ts";
import { colorizeLeadingCommand, recognizedLeadingCommand } from "./command-paint.ts";

const RESET_BG = "\x1b[49m";
const BORDER_GLYPH = "─";
/** Scroll indicators (native Editor) start with three border glyphs and a space. */
const SCROLL_BORDER_PREFIX = `${BORDER_GLYPH}${BORDER_GLYPH}${BORDER_GLYPH} `;
const SGR_STRIP = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export { PROMPT_CHAR };

export function isBashInput(text: string): boolean {
	return text.trimStart().startsWith("!");
}

const MARKDOWN_BLOCK_START = /^(```|~~~|# |>)/;

/** Display-only prefix for historical user messages. Idempotent. */
export function prefixUserPrompt(markdown: string, prompt = PROMPT_CHAR): string {
	// Leading blank lines in the message would put the prompt on an empty top
	// row (input artifact of pressing Enter first); drop them before prefixing.
	const text = markdown.replace(/^\uFEFF/, "").replace(/^\n+/, "");
	const body = text.trimStart();
	if (body.startsWith(prompt)) return markdown;
	if (body.length === 0) return prompt;
	// Fences, headings and blockquotes need column 0, so the prompt gets its
	// own row above them (Codex look). Lists (`- `, `1. `) flow inline instead:
	// an own-row prompt would leave a blank top line above the list.
	if (MARKDOWN_BLOCK_START.test(body)) return `${prompt}\n\n${text}`;
	const [first, ...rest] = text.split("\n");
	if (rest.length === 0) return `${prompt} ${text}`;
	// Continuation lines of plain text align under the text after the prompt
	// glyph (Codex look), mirroring the input box's wrapped rows. Markdown
	// block starts and blank lines stay flush so rendering is unaffected.
	const indent = " ".repeat(visibleWidth(prompt) + 1);
	const aligned = rest
		.map((line) => (line.trim().length === 0 || MARKDOWN_BLOCK_START.test(line) ? line : indent + line))
		.join("\n");
	return `${prompt} ${first}\n${aligned}`;
}

export type EditorChromeLayout = {
	contentIndex: number;
	bottomIndex: number;
};

/**
 * A row is editor chrome if it is a border (`─` only, full width) or a scroll
 * indicator (`─── ↑ N more …`). Content rows are always indented by the
 * prompt gutter, so typed box-drawing never matches. Autocomplete rows below
 * the frame can contain `─` in their text; treating them as chrome would
 * strip their glyphs and mis-fill the background (AGENTS rules 1–2).
 */
function isChromeRow(line: string): boolean {
	const plain = line.replace(SGR_STRIP, "");
	return plain.startsWith(SCROLL_BORDER_PREFIX) || (plain.length > 0 && !/[^─]/.test(plain));
}

/** Locate the Codex panel. Missing chrome (no bottom border) means leave Pi's lines alone. */
export function inspectEditorChrome(lines: readonly string[]): EditorChromeLayout | undefined {
	if (lines.length < 2) return undefined;
	let bottom = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (isChromeRow(lines[i] ?? "")) {
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

export function insertPrompt(
	line: string,
	prompt: string,
	gutterCols = PROMPT_GUTTER_COLS,
	leftPad = PROMPT_LEFT_PAD,
): string {
	const promptWidth = visibleWidth(prompt);
	const gap = Math.max(1, gutterCols - leftPad - promptWidth);
	const prefix = " ".repeat(leftPad) + prompt + " ".repeat(gap);
	const width = visibleWidth(line);
	const padded = width >= gutterCols ? line : line + " ".repeat(gutterCols - width);
	return prefix + sliceByColumn(padded, gutterCols, Math.max(0, visibleWidth(padded) - gutterCols));
}

export function fillRow(line: string, width: number, bg: string, measure: (text: string) => number = visibleWidth): string {
	let fitted = line;
	const current = measure(line);
	if (current > width) fitted = truncateToWidth(line, width, "");
	else if (current < width) fitted = `${line}${" ".repeat(width - current)}`;
	if (bg === "" || bg === RESET_BG) return fitted;
	// SGR full resets: long (`ESC[0m`) and short (`ESC[m`) forms are equivalent; re-arm the fill on either.
	const withBg = fitted.replace(/\x1b\[0?m/g, `\x1b[0m${bg}`);
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

/**
 * Controlled internal probe for "Enter completes a partial pick without
 * submitting": `autocompletePrefix` / `autocompleteList` are TS-private in
 * pi-tui's Editor (only `isShowingAutocomplete()` is public as of Pi 0.84.2).
 * Read-only, guarded, and degrades to native Enter on any upstream shape
 * change. Re-verify after Pi upgrades (AGENTS.md rules 1–2).
 */
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
	// When the frame is scrolled, the top border is `─── ↑ N more …` and the
	// first content row is a mid-message line; the prompt belongs to the first
	// (scrolled-off) line and must not be pinned here (Codex behavior).
	const scrolled = lines[0]?.includes("↑") ?? false;
	if (paint.command) {
		next[layout.contentIndex] = colorizeLeadingCommand(
			next[layout.contentIndex] ?? "",
			paint.command,
			paint.accent,
			FG_RESET,
		);
	}
	if (!scrolled) {
		next[layout.contentIndex] = insertPrompt(next[layout.contentIndex] ?? "", paint.prompt);
	}
	for (let i = 0; i <= layout.bottomIndex; i++) {
		const line = next[i] ?? "";
		const stripped = i === 0 || i === layout.bottomIndex ? replaceBorderGlyphs(line) : line;
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

export function installEditor(ctx: ExtensionContext, pi: ExtensionAPI, getCatalog: () => SkillCatalog): void {
	const theme = ctx.ui.theme;
	ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
		return new CraftEditor(tui, editorTheme, keybindings, theme, getCatalog);
	});
}
