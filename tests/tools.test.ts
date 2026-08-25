import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { COLLAPSED_PREVIEW_LINES, TOOL_SHELL_PAD_X, TOOL_SHELL_PAD_Y } from "../extensions/config.ts";
import {
	isPreviewTool,
	OVERRIDE_TOOL_NAMES,
	PREVIEW_TOOL_NAMES,
	shouldOverrideBuiltinPreview,
	toolOwnerSource,
	type PreviewToolName,
} from "../extensions/tool-preview/tool-preview.ts";
import {
	argText,
	collapsePreviewLines,
	formatCollapsedPreview,
	resultText,
	splitPreviewLines,
} from "../extensions/tool-preview/preview.ts";
import { paintShellCall, paintShellResult, usesReadShellBox } from "../extensions/tool-preview/shell.ts";

const theme = {
	fg: (color: string, text: string) => `${color}:${text}`,
};

function source(name: string, origin: string): ToolInfo {
	return {
		name,
		description: name,
		parameters: {} as ToolInfo["parameters"],
		sourceInfo: {
			path: `<${origin}:${name}>`,
			source: origin,
			scope: "user",
			origin: "package",
		},
	};
}

describe("collapsed preview slicing", () => {
	it("keeps at most three body lines from the head", () => {
		const text = ["a", "b", "c", "d", "e"].join("\n");
		assert.deepEqual(collapsePreviewLines(text, "head"), {
			shown: ["a", "b", "c"],
			remaining: 2,
		});
		assert.equal(COLLAPSED_PREVIEW_LINES, 3);
	});

	it("takes the tail for bash-style output", () => {
		assert.deepEqual(collapsePreviewLines("a\nb\nc\nd\ne", "tail"), {
			shown: ["c", "d", "e"],
			remaining: 2,
		});
	});

	it("does not invent a remainder when the result already fits", () => {
		assert.deepEqual(collapsePreviewLines("a\nb", "head"), { shown: ["a", "b"], remaining: 0 });
		assert.deepEqual(collapsePreviewLines("", "head"), { shown: [], remaining: 0 });
	});

	it("drops trailing blank lines before counting", () => {
		assert.deepEqual(splitPreviewLines("a\nb\n\n"), ["a", "b"]);
		assert.deepEqual(collapsePreviewLines("a\nb\nc\n\n", "head"), {
			shown: ["a", "b", "c"],
			remaining: 0,
		});
	});
});

describe("collapsed preview paint", () => {
	it("paints three body lines and a remainder hint", () => {
		const painted = formatCollapsedPreview(
			{ shown: ["one", "two", "three"], remaining: 12 },
			theme,
			"toolOutput",
			"Ctrl+O to expand",
		);
		assert.equal(
			painted,
			"\ntoolOutput:one\ntoolOutput:two\ntoolOutput:three\nmuted:... (12 more lines, Ctrl+O to expandmuted:)",
		);
	});

	it("uses error color and stays quiet when there is no body", () => {
		assert.equal(formatCollapsedPreview({ shown: [], remaining: 0 }, theme, "error", "hint"), "");
		assert.equal(
			formatCollapsedPreview({ shown: ["boom"], remaining: 0 }, theme, "error", "hint"),
			"\nerror:boom",
		);
	});
});

describe("preview sources", () => {
	it("joins text blocks and reads string args", () => {
		assert.equal(
			resultText({
				content: [
					{ type: "text", text: "a" },
					{ type: "image" },
					{ type: "text", text: "b" },
				],
			}),
			"a\nb",
		);
		assert.equal(argText({ path: "src/a.ts", content: "hi" }, "path"), "src/a.ts");
		assert.equal(argText({ path: 1 }, "path"), "");
	});
});

describe("builtin ownership", () => {
	it("overrides only tools still owned by Pi", () => {
		const tools = [
			source("grep", "builtin"),
			source("bash", "extension"),
			source("find", "builtin"),
			source("read", "builtin"),
		];
		assert.equal(toolOwnerSource(tools, "grep"), "builtin");
		assert.equal(shouldOverrideBuiltinPreview(tools, "grep"), true);
		assert.equal(shouldOverrideBuiltinPreview(tools, "bash"), false);
		assert.equal(shouldOverrideBuiltinPreview(tools, "ls"), false);
		assert.equal(shouldOverrideBuiltinPreview(tools, "read"), true);
		assert.equal(shouldOverrideBuiltinPreview([...tools, source("ls", "builtin")], "ls"), true);
		const names: PreviewToolName[] = ["grep", "bash", "find"];
		assert.deepEqual(
			names.filter((name) => shouldOverrideBuiltinPreview(tools, name)),
			["grep", "find"],
		);
	});

	it("overrides preview tools and read, not write or edit", () => {
		assert.deepEqual([...PREVIEW_TOOL_NAMES], ["bash", "grep", "find", "ls"]);
		assert.deepEqual([...OVERRIDE_TOOL_NAMES], ["bash", "grep", "find", "ls", "read"]);
		assert.equal(isPreviewTool("grep"), true);
		assert.equal(isPreviewTool("read"), false);
		assert.equal(isPreviewTool("write"), false);
		assert.equal(isPreviewTool("edit"), false);
	});
});

describe("compact tool shell", () => {
	const theme = { bg: (_color: string, text: string) => text };

	it("matches Pi's native vertical pad when a read row is boxed", () => {
		const boxed = new Box(TOOL_SHELL_PAD_X, TOOL_SHELL_PAD_Y);
		boxed.addChild(new Text("read a.ts", 0, 0));
		const native = new Box(1, 1);
		native.addChild(new Text("read a.ts", 0, 0));
		assert.equal(TOOL_SHELL_PAD_X, 1);
		assert.equal(TOOL_SHELL_PAD_Y, 1);
		assert.equal(boxed.render(40).length, 3);
		assert.equal(native.render(40).length, 3);
	});

	it("keeps call and result in one box and hides the result slot", () => {
		const state: Record<string, unknown> = {};
		const context = { isPartial: false, isError: false, state };
		const shell = paintShellCall(new Text("read a.ts", 0, 0), theme, context);
		const hidden = paintShellResult(new Text("body", 0, 0), theme, context);
		assert.equal(hidden.render(40).length, 0);
		assert.equal(shell.render(40).length, 4);
		assert.equal(paintShellResult(new Text("body", 0, 0), theme, context), hidden);
	});

	it("skips the colored box for a collapsed successful read", () => {
		assert.equal(usesReadShellBox({ expanded: false, isError: false }), false);
		assert.equal(usesReadShellBox({ expanded: true, isError: false }), true);
		assert.equal(usesReadShellBox({ expanded: false, isError: true }), true);
	});
});
