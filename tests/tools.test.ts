import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { COLLAPSED_PREVIEW_LINES } from "../extensions/config.ts";
import {
	expandLeadingTilde,
	isPreviewTool,
	OVERRIDE_TOOL_NAMES,
	PREVIEW_TOOL_NAMES,
	resolveToolSettings,
	shouldOverrideBuiltinPreview,
	toolOwnerSource,
	type PreviewToolName,
} from "../extensions/tool-preview/tool-preview.ts";
import {
	collapsePreviewLines,
	formatCollapsedPreview,
	resultText,
	splitPreviewLines,
} from "../extensions/tool-preview/preview.ts";

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
	it("joins text blocks from the tool result", () => {
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

describe("tool settings bridge", () => {
	const home = "/Users/demo";

	it("expands a leading tilde the same way Pi does", () => {
		assert.equal(expandLeadingTilde("~", home), home);
		assert.equal(expandLeadingTilde("~/.local/bin/zsh", home), "/Users/demo/.local/bin/zsh");
		assert.equal(expandLeadingTilde("/usr/bin/zsh", home), "/usr/bin/zsh");
		assert.equal(expandLeadingTilde("~foo/bin", home), "~foo/bin");
		assert.equal(expandLeadingTilde("${HOME}/bin/zsh", home), "${HOME}/bin/zsh");
	});

	it("lets project settings override global shellPath after tilde expansion", () => {
		assert.deepEqual(
			resolveToolSettings(
				{ shellPath: "~/global/zsh", shellCommandPrefix: "global" },
				{ shellPath: "~/project/zsh", shellCommandPrefix: "project" },
				home,
			),
			{
				shellPath: "/Users/demo/project/zsh",
				commandPrefix: "project",
				autoResizeImages: true,
			},
		);
	});

	it("passes through images.autoResize false instead of the factory default", () => {
		assert.equal(
			resolveToolSettings({ images: { autoResize: false } }, {}, home).autoResizeImages,
			false,
		);
		assert.equal(
			resolveToolSettings({ images: { autoResize: false } }, { images: { autoResize: true } }, home)
				.autoResizeImages,
			true,
		);
		assert.equal(resolveToolSettings({}, {}, home).autoResizeImages, true);
	});
});

