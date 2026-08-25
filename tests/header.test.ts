import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { HEADER_PAD_Y, LOGO_LEFT_PAD, LOGO_TEXT_GAP } from "../extensions/config.ts";
import { formatHeaderPath, padHeaderVertically } from "../extensions/header/header.ts";
import { LAST_LOGO_FRAME, LOGO_CELL, LOGO_ROWS, logoColumnWidth, renderLogoFrame } from "../extensions/header/logo.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

function stubTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
	} as Theme;
}

describe("header logo", () => {
	it("renders the settled mark as four rows of triple-width cells", () => {
		const rows = renderLogoFrame(LAST_LOGO_FRAME, stubTheme());
		assert.equal(LOGO_CELL, "███");
		assert.equal(LOGO_ROWS, 4);
		assert.equal(rows.length, 4);
		assert.equal(logoColumnWidth(), 12);
		for (const row of rows) {
			assert.equal(visibleWidth(row), 12);
		}
	});

	it("keeps one column of left inset and three columns before the copy", () => {
		assert.equal(LOGO_LEFT_PAD, 1);
		assert.equal(LOGO_TEXT_GAP, 3);
	});
});

describe("header copy layout", () => {
	it("abbreviates the project path from home", () => {
		assert.equal(formatHeaderPath("/Users/eric/Code/project", 80, "/Users/eric"), "~/Code/project");
		assert.ok(formatHeaderPath("/Users/eric/very/long/nested/path/to/project", 18, "/Users/eric").includes("project"));
	});

	it("adds one blank row above and below the header block", () => {
		assert.equal(HEADER_PAD_Y, 1);
		assert.deepEqual(padHeaderVertically(["π  Pi", "   slogan"]), ["", "π  Pi", "   slogan", ""]);
	});
});
