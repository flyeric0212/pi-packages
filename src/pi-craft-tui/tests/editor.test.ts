import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	colorizeLeadingCommand,
	leadingSlashToken,
	recognizedLeadingCommand,
} from "../editor/command-paint.ts";
import {
	fillRow,
	inspectEditorChrome,
	insertPrompt,
	isBashInput,
	isEmptyBackground,
	paintCraftEditor,
	prefixUserPrompt,
	PROMPT_CHAR,
	replaceBorderGlyphs,
	shouldAcceptSlashCompletionOnly,
	slashAutocompleteSelection,
	typedSlashName,
} from "../editor/editor.ts";
import type { Editor } from "@earendil-works/pi-tui";
import { buildSkillCatalog } from "../catalog.ts";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

describe("CraftEditor layout helpers", () => {
	it("uses the Codex prompt glyph", () => {
		assert.equal(PROMPT_CHAR, "❯");
	});

	it("detects bash mode from a leading !", () => {
		assert.equal(isBashInput("!ls"), true);
		assert.equal(isBashInput("  !git status"), true);
		assert.equal(isBashInput("hello"), false);
	});

	it("turns former border rows into vertical padding", () => {
		assert.equal(replaceBorderGlyphs("────────"), "        ");
	});

	it("prefixes historical user markdown with the prompt glyph", () => {
		assert.equal(prefixUserPrompt("hello"), "❯ hello");
		assert.equal(prefixUserPrompt("❯ already"), "❯ already");
		assert.equal(prefixUserPrompt("```ts\nconst x = 1\n```"), "❯\n\n```ts\nconst x = 1\n```");
		assert.equal(prefixUserPrompt(""), "❯");
	});

	it("keeps one column of left padding and aligns content with gutter", () => {
		assert.equal(insertPrompt("   hello", "❯"), " ❯ hello");
	});

	it("aligns multiline editor content vertically", () => {
		const multilineFrame = ["────────", "   first line", "   second line", "────────"];
		const painted = paintCraftEditor(multilineFrame, {
			width: 25,
			text: "first line\nsecond line",
			bg: "",
			prompt: "❯",
			accent: "",
		});
		assert.equal(painted[1], " ❯ first line");
		assert.equal(painted[2], "   second line");
		// Check that both lines start text at column index 3
		assert.equal(painted[1]?.indexOf("first"), 3);
		assert.equal(painted[2]?.indexOf("second"), 3);
	});

	it("clamps a full-width prompt row so inserting ❯ does not overflow", () => {
		const width = 80;
		const line = " ".repeat(width);
		const fitted = fillRow(insertPrompt(line, "❯"), width, "");
		assert.ok(visibleWidth(fitted) <= width);
		assert.equal(truncateToWidth(fitted, width, ""), fitted);
		assert.match(fitted, /^ ❯ /);
	});

	it("skips fill when the theme background is the terminal default", () => {
		assert.equal(isEmptyBackground(""), true);
		assert.equal(isEmptyBackground("\x1b[49m"), true);
		assert.equal(isEmptyBackground("\x1b[48;2;45;45;48m"), false);
	});
});

const catalog = buildSkillCatalog([
	{ name: "skill:code-review", source: "skill" },
	{ name: "clear", source: "extension" },
]);

describe("leading command highlighting", () => {
	it("reads the first-line slash token", () => {
		assert.equal(leadingSlashToken("/clear xxx"), "/clear");
		assert.equal(leadingSlashToken("  /code-review\nmore"), "/code-review");
		assert.equal(leadingSlashToken("/skill:code-review foo"), "/skill:code-review");
		assert.equal(leadingSlashToken("please /clear"), undefined);
	});

	it("only highlights commands that actually run", () => {
		assert.equal(recognizedLeadingCommand("/clear xxx", catalog), "/clear");
		assert.equal(recognizedLeadingCommand("/code-review", catalog), "/code-review");
		assert.equal(recognizedLeadingCommand("/skill:code-review", catalog), "/skill:code-review");
		assert.equal(recognizedLeadingCommand("/model", catalog), "/model");
		assert.equal(recognizedLeadingCommand("/unknown", catalog), undefined);
		assert.equal(recognizedLeadingCommand("use /clear here", catalog), undefined);
	});

	it("paints the command and leaves the arguments alone", () => {
		const open = "\x1b[36m";
		const close = "\x1b[39m";
		const line = "  /clear xxx";
		const painted = colorizeLeadingCommand(line, "/clear", open, close);
		assert.equal(painted, `  ${open}/clear${close} xxx`);
		assert.equal(visibleWidth(painted), visibleWidth(line));
		assert.equal(colorizeLeadingCommand("  hello", "/clear", open, close), "  hello");
	});

	it("re-applies color after a cursor reverse-video reset inside the token", () => {
		const open = "{";
		const close = "}";
		const line = `  /cl\x1b[7me\x1b[0mar xxx`;
		assert.equal(colorizeLeadingCommand(line, "/clear", open, close), `  {/cl\x1b[7me\x1b[0m{ar} xxx`);
	});
});

describe("slash Enter vs completion", () => {
	it("treats a partial prefix as completion-only", () => {
		assert.equal(typedSlashName("/cl"), "cl");
		assert.equal(shouldAcceptSlashCompletionOnly("/cl", "clear"), true);
		assert.equal(shouldAcceptSlashCompletionOnly("/code", "code-review"), true);
		assert.equal(shouldAcceptSlashCompletionOnly("/", "clear"), true);
	});

	it("submits when the typed command already matches the selected item", () => {
		assert.equal(shouldAcceptSlashCompletionOnly("/clear", "clear"), false);
		assert.equal(shouldAcceptSlashCompletionOnly("/code-review", "code-review"), false);
	});

	it("does not submit when the highlight is a different command than what was typed", () => {
		assert.equal(shouldAcceptSlashCompletionOnly("/clear", "clone"), true);
	});

	it("leaves @ and argument completions to Pi", () => {
		assert.equal(typedSlashName("@src"), undefined);
		assert.equal(shouldAcceptSlashCompletionOnly("@src", "file.ts"), false);
		assert.equal(shouldAcceptSlashCompletionOnly("/clear ", "auth"), false);
	});

	it("does not intercept Enter when autocomplete internals are missing", () => {
		const editor = {
			isShowingAutocomplete: () => true,
		} as unknown as Editor;
		assert.equal(slashAutocompleteSelection(editor), undefined);
	});

	it("does not intercept Enter when reading the pick throws", () => {
		const editor = {
			isShowingAutocomplete: () => true,
			autocompletePrefix: "/cl",
			autocompleteList: {
				getSelectedItem() {
					throw new Error("gone");
				},
			},
		} as unknown as Editor;
		assert.equal(slashAutocompleteSelection(editor), undefined);
	});
});

describe("editor chrome probe", () => {
	const frame = ["────────", "   hello", "────────", "/clear", "item"];

	it("finds the panel bottom and leaves the autocomplete rows below it", () => {
		assert.deepEqual(inspectEditorChrome(frame), { contentIndex: 1, bottomIndex: 2 });
		const painted = paintCraftEditor(frame, {
			width: 20,
			text: "hello",
			bg: "",
			prompt: "❯",
			accent: "",
		});
		assert.match(painted[1]!, /❯ hello/);
		assert.equal(painted[3], "/clear");
		assert.equal(painted[4], "item");
		assert.ok(!painted[3]!.includes("❯"));
	});

	it("passes the native lines through when there is no border chrome", () => {
		const lines = ["hello", "world", "item"];
		assert.equal(inspectEditorChrome(lines), undefined);
		assert.deepEqual(
			paintCraftEditor(lines, { width: 20, text: "hello", bg: "", prompt: "❯", accent: "" }),
			lines,
		);
	});

	it("strips chrome ─ but keeps box-drawing in the typed content", () => {
		const painted = paintCraftEditor(["────────", "   a─b", "   ────", "────────", "/clear"], {
			width: 20,
			text: "a─b\n────",
			bg: "",
			prompt: "❯",
			accent: "",
		});
		assert.ok(!painted[0]!.includes("─"));
		assert.match(painted[1]!, /a─b/);
		assert.equal(painted[2], "   ────");
		assert.ok(!painted[3]!.includes("─"));
		assert.equal(painted[4], "/clear");
	});

	it("still fills content rows after leaving content glyphs alone", () => {
		const bg = "\x1b[48;2;1;2;3m";
		const painted = paintCraftEditor(["────────", "   a─b", "────────"], {
			width: 12,
			text: "a─b",
			bg,
			prompt: "❯",
			accent: "",
		});
		assert.ok(painted[1]!.includes("─"));
		assert.ok(painted[1]!.includes(bg));
		assert.ok(!painted[0]!.includes("─"));
		assert.ok(!painted[2]!.includes("─"));
	});
});
