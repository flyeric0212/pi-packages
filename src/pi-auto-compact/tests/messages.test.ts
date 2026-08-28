import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMessages } from "../messages.ts";

describe("messages", () => {
	it("returns Chinese copy by default", () => {
		const zh = getMessages("zh");
		assert.ok(zh.resumePrompt.includes("自动压缩"));
		assert.ok(zh.notifyCompacting(88).includes("88%"));
		assert.ok(zh.notifyResumed.length > 0);
		assert.ok(zh.notifyFailed("boom", false).includes("boom"));
		assert.ok(zh.notifyFailed("boom", true).includes("连续失败"));
		assert.ok(zh.notifySuggestCompact(80).includes("/compact"));
	});

	it("returns English copy for en", () => {
		const en = getMessages("en");
		assert.ok(en.resumePrompt.includes("auto-compacted"));
		assert.ok(en.notifyCompacting(88).includes("88%"));
		assert.ok(en.notifyFailed("boom", false).includes("boom"));
		assert.ok(en.notifyFailed("boom", true).includes("disabled"));
		assert.ok(en.resumePrompt !== getMessages("zh").resumePrompt);
	});
});