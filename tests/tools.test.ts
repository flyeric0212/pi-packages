import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import {
	resolveToolSettings,
	shouldOverrideBuiltinPreview,
	toolOwnerSource,
} from "../extensions/tool-preview/tool-preview.ts";

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

describe("read builtin ownership", () => {
	it("targets read only while Pi still owns it", () => {
		assert.equal(toolOwnerSource([source("read", "builtin")], "read"), "builtin");
		assert.equal(shouldOverrideBuiltinPreview([source("read", "builtin")], "read"), true);
		assert.equal(shouldOverrideBuiltinPreview([source("read", "extension")], "read"), false);
		assert.equal(shouldOverrideBuiltinPreview([], "read"), false);
	});
});

describe("read tool settings bridge", () => {
	it("lets project settings override global images.autoResize", () => {
		assert.equal(
			resolveToolSettings({ images: { autoResize: true } }, { images: { autoResize: false } }).autoResizeImages,
			false,
		);
		assert.equal(resolveToolSettings({ images: { autoResize: false } }, {}).autoResizeImages, false);
		assert.equal(resolveToolSettings({}, {}).autoResizeImages, true);
	});
});