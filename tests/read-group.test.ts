import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assignReadRole,
	collectReadResults,
	contentHasImage,
	formatGroupedReadCall,
	isGroupableRead,
	readArgPath,
	readCallsAround,
	readCallsInMessage,
	type BranchEntry,
	type LiveRead,
	type ReadCallRef,
	type ReadResultFact,
} from "../extensions/tool-preview/group.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function live(partial: Partial<LiveRead> & { id: string }): LiveRead {
	return {
		expanded: false,
		isPartial: false,
		isError: false,
		hasImage: false,
		...partial,
	};
}

function results(...ids: string[]): Map<string, ReadResultFact> {
	return new Map(ids.map((id) => [id, { isError: false, hasImage: false }]));
}

const ordered: ReadCallRef[] = [
	{ id: "a", path: "src/a.ts", read: true },
	{ id: "b", path: "src/b.ts", read: true },
	{ id: "c", path: "src/c.ts", read: true },
];

describe("read call extraction", () => {
	it("reads path or file_path", () => {
		assert.equal(readArgPath({ path: "a.ts" }), "a.ts");
		assert.equal(readArgPath({ file_path: "b.ts" }), "b.ts");
		assert.equal(readArgPath({ path: 1 }), "");
	});

	it("detects image content blocks", () => {
		assert.equal(contentHasImage([{ type: "text", text: "x" }]), false);
		assert.equal(contentHasImage([{ type: "image", data: "aa" }]), true);
	});

	it("collects consecutive reads from one assistant message", () => {
		const message = {
			role: "assistant" as const,
			content: [
				{ type: "text", text: "looking" },
				{ type: "toolCall", id: "a", name: "read", arguments: { path: "a.ts" } },
				{ type: "toolCall", id: "g", name: "grep", arguments: { pattern: "x" } },
				{ type: "toolCall", id: "b", name: "read", arguments: { path: "b.ts" } },
			],
		};
		assert.deepEqual(readCallsInMessage(message), [
			{ id: "a", path: "a.ts", read: true },
			{ id: "g", path: "", read: false },
			{ id: "b", path: "b.ts", read: true },
		]);
	});

	it("collects reads across assistant messages until a user turn", () => {
		const entries: BranchEntry[] = [
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "old", name: "read", arguments: { path: "old.ts" } }],
				},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "a", name: "read", arguments: { path: "a.ts" } }],
				},
			},
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "next" }] } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "b", name: "read", arguments: { path: "b.ts" } }],
				},
			},
		];
		assert.deepEqual(readCallsAround(entries, "a"), [
			{ id: "old", path: "old.ts", read: true },
			{ id: "a", path: "a.ts", read: true },
			{ id: "", path: "", read: false },
			{ id: "b", path: "b.ts", read: true },
		]);
		assert.deepEqual(readCallsAround(entries, "missing"), []);
	});

	it("appends a live read that is not in the session yet", () => {
		const entries: BranchEntry[] = [
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "a", name: "read", arguments: { path: "a.ts" } }],
				},
			},
			{ type: "message", message: { role: "toolResult", toolCallId: "a", isError: false, content: [] } },
		];
		const extra: ReadCallRef[] = [{ id: "b", path: "b.ts", read: true }];
		const ordered = readCallsAround(entries, "b", extra);
		assert.deepEqual(ordered, [
			{ id: "a", path: "a.ts", read: true },
			{ id: "b", path: "b.ts", read: true },
		]);
		const facts = new Map<string, ReadResultFact>([
			["a", { isError: false, hasImage: false }],
			["b", { isError: false, hasImage: false }],
		]);
		assert.equal(assignReadRole(ordered, facts, live({ id: "b" })).role, "follower");
		assert.deepEqual(assignReadRole(ordered, facts, live({ id: "a" })).paths, ["a.ts", "b.ts"]);
	});

	it("indexes toolResult error and image flags", () => {
		const entries: BranchEntry[] = [
			{ type: "message", message: { role: "toolResult", toolCallId: "a", isError: false, content: [] } },
			{
				type: "message",
				message: { role: "toolResult", toolCallId: "b", isError: true, content: [{ type: "text", text: "nope" }] },
			},
			{
				type: "message",
				message: { role: "toolResult", toolCallId: "c", isError: false, content: [{ type: "image" }] },
			},
		];
		const map = collectReadResults(entries);
		assert.deepEqual(map.get("a"), { isError: false, hasImage: false });
		assert.deepEqual(map.get("b"), { isError: true, hasImage: false });
		assert.deepEqual(map.get("c"), { isError: false, hasImage: true });
	});
});

describe("read grouping", () => {
	it("keeps a single settled read standalone", () => {
		const assignment = assignReadRole([{ id: "a", path: "a.ts", read: true }], results("a"), live({ id: "a" }));
		assert.equal(assignment.role, "standalone");
		assert.deepEqual(assignment.paths, ["a.ts"]);
	});

	it("merges consecutive settled collapsed reads", () => {
		const facts = results("a", "b", "c");
		assert.equal(assignReadRole(ordered, facts, live({ id: "a" })).role, "leader");
		assert.deepEqual(assignReadRole(ordered, facts, live({ id: "a" })).paths, ["src/a.ts", "src/b.ts", "src/c.ts"]);
		assert.equal(assignReadRole(ordered, facts, live({ id: "b" })).role, "follower");
		assert.equal(assignReadRole(ordered, facts, live({ id: "b" })).leaderId, "a");
		assert.equal(assignReadRole(ordered, facts, live({ id: "c" })).role, "follower");
	});

	it("keeps the first in-flight read visible", () => {
		const only: ReadCallRef[] = [{ id: "b", path: "src/b.ts", read: true }];
		assert.equal(assignReadRole(only, new Map(), live({ id: "b", isPartial: true })).role, "standalone");
	});

	it("joins an in-flight read to the preceding settled run", () => {
		const pair: ReadCallRef[] = [
			{ id: "a", path: "src/a.ts", read: true },
			{ id: "b", path: "src/b.ts", read: true },
		];
		const facts = results("a");
		assert.equal(assignReadRole(pair, facts, live({ id: "b", isPartial: true })).role, "follower");
		assert.equal(assignReadRole(pair, facts, live({ id: "a" })).role, "leader");
		assert.deepEqual(assignReadRole(pair, facts, live({ id: "a" })).paths, ["src/a.ts", "src/b.ts"]);
	});

	it("breaks the group on an error", () => {
		const facts = new Map<string, ReadResultFact>([
			["a", { isError: false, hasImage: false }],
			["b", { isError: true, hasImage: false }],
			["c", { isError: false, hasImage: false }],
		]);
		assert.equal(assignReadRole(ordered, facts, live({ id: "a" })).role, "standalone");
		assert.equal(assignReadRole(ordered, facts, live({ id: "b", isError: true })).role, "standalone");
		assert.equal(assignReadRole(ordered, facts, live({ id: "c" })).role, "standalone");
	});

	it("merges consecutive reads from later assistant turns", () => {
		const entries: BranchEntry[] = [
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "a", name: "read", arguments: { path: "a.ts" } }],
				},
			},
			{ type: "message", message: { role: "toolResult", toolCallId: "a", isError: false, content: [] } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "b", name: "read", arguments: { path: "b.ts" } }],
				},
			},
			{ type: "message", message: { role: "toolResult", toolCallId: "b", isError: false, content: [] } },
		];
		const ordered = readCallsAround(entries, "b");
		const facts = collectReadResults(entries);
		assert.equal(assignReadRole(ordered, facts, live({ id: "a" })).role, "leader");
		assert.deepEqual(assignReadRole(ordered, facts, live({ id: "a" })).paths, ["a.ts", "b.ts"]);
		assert.equal(assignReadRole(ordered, facts, live({ id: "b" })).role, "follower");
	});

	it("does not group reads across a user turn", () => {
		const ordered: ReadCallRef[] = [
			{ id: "a", path: "a.ts", read: true },
			{ id: "", path: "", read: false },
			{ id: "b", path: "b.ts", read: true },
		];
		const facts = results("a", "b");
		assert.equal(assignReadRole(ordered, facts, live({ id: "a" })).role, "standalone");
		assert.equal(assignReadRole(ordered, facts, live({ id: "b" })).role, "standalone");
	});

	it("does not group across a non-read tool", () => {
		const split: ReadCallRef[] = [
			{ id: "a", path: "a.ts", read: true },
			{ id: "g", path: "", read: false },
			{ id: "b", path: "b.ts", read: true },
		];
		const facts = results("a", "b");
		assert.equal(assignReadRole(split, facts, live({ id: "a" })).role, "standalone");
		assert.equal(assignReadRole(split, facts, live({ id: "b" })).role, "standalone");
	});

	it("does not group when expanded", () => {
		const facts = results("a", "b", "c");
		assert.equal(assignReadRole(ordered, facts, live({ id: "a", expanded: true })).role, "standalone");
		assert.equal(assignReadRole(ordered, facts, live({ id: "b", expanded: true })).role, "standalone");
	});

	it("does not group a read that returned an image", () => {
		const facts = new Map<string, ReadResultFact>([
			["a", { isError: false, hasImage: false }],
			["b", { isError: false, hasImage: true }],
		]);
		const pair: ReadCallRef[] = [
			{ id: "a", path: "a.ts", read: true },
			{ id: "b", path: "pic.png", read: true },
		];
		assert.equal(assignReadRole(pair, facts, live({ id: "a" })).role, "standalone");
		assert.equal(assignReadRole(pair, facts, live({ id: "b", hasImage: true })).role, "standalone");
	});

	it("paints grouped paths as a stacked list", () => {
		assert.equal(
			formatGroupedReadCall(["src/a.ts", "src/b.ts", "src/c.ts"], theme),
			"read src/a.ts\n     src/b.ts\n     src/c.ts",
		);
	});
});
