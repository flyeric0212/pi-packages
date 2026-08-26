import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	RESERVED_COMMAND_NAMES,
	SKILL_PREFIX,
	buildSkillCatalog,
	canUseShortName,
	isInvocableSlashName,
	skillShortName,
	type CommandRecord,
} from "../extensions/catalog.ts";
import { rewriteLeadingSkillCommand, shortenSkillSuggestions } from "../extensions/commands/skill-shortcuts.ts";

function commands(rows: CommandRecord[]): CommandRecord[] {
	return rows;
}

const skills = buildSkillCatalog(
	commands([
		{ name: "skill:code-review", source: "skill", description: "Review code" },
		{ name: "skill:clear", source: "skill", description: "A skill named clear" },
		{ name: "fix-tests", source: "prompt", description: "Fix tests" },
		{ name: "skill:fix-tests", source: "skill", description: "Skill that collides with a template" },
		{ name: "clear", source: "extension" },
	]),
);

describe("skill catalog", () => {
	it("strips the official skill: prefix", () => {
		assert.equal(skillShortName("skill:code-review"), "code-review");
		assert.equal(skillShortName("code-review"), undefined);
		assert.equal(skillShortName(SKILL_PREFIX), undefined);
	});

	it("blocks builtins, this package's commands, and taken names", () => {
		assert.equal(canUseShortName("code-review", skills), true);
		assert.equal(canUseShortName("clear", skills), false);
		assert.equal(canUseShortName("cls", skills), false);
		assert.equal(canUseShortName("model", skills), false);
		assert.equal(canUseShortName("fix-tests", skills), false);
		assert.ok(RESERVED_COMMAND_NAMES.has("reload"));
		assert.ok(RESERVED_COMMAND_NAMES.has("llama"));
	});

	it("treats builtins, short skills, and /skill: names as invocable", () => {
		assert.equal(isInvocableSlashName("clear", skills), true);
		assert.equal(isInvocableSlashName("code-review", skills), true);
		assert.equal(isInvocableSlashName("skill:code-review", skills), true);
		assert.equal(isInvocableSlashName("fix-tests", skills), true);
		assert.equal(isInvocableSlashName("unknown", skills), false);
	});
});

describe("leading /skill rewrite", () => {
	it("rewrites a leading short name into the native skill command", () => {
		assert.equal(rewriteLeadingSkillCommand("/code-review", skills), "/skill:code-review");
		assert.equal(
			rewriteLeadingSkillCommand("/code-review auth.ts", skills),
			"/skill:code-review auth.ts",
		);
	});

	it("keeps indent and folds a following body into skill args", () => {
		assert.equal(rewriteLeadingSkillCommand("  /code-review", skills), "  /skill:code-review");
		assert.equal(
			rewriteLeadingSkillCommand("/code-review\n\nplease review auth", skills),
			"/skill:code-review please review auth",
		);
	});

	it("leaves official skill commands, collisions, and unknown names alone", () => {
		assert.equal(rewriteLeadingSkillCommand("/skill:code-review", skills), undefined);
		assert.equal(rewriteLeadingSkillCommand("/clear", skills), undefined);
		assert.equal(rewriteLeadingSkillCommand("/model", skills), undefined);
		assert.equal(rewriteLeadingSkillCommand("/fix-tests", skills), undefined);
		assert.equal(rewriteLeadingSkillCommand("/unknown", skills), undefined);
		assert.equal(rewriteLeadingSkillCommand("use /code-review in a sentence", skills), undefined);
	});
});

describe("skill autocomplete labels", () => {
	it("shows the short name unless the user already typed skill:", () => {
		const items = [
			{ value: "copy", label: "copy" },
			{ value: "skill:code-review", label: "skill:code-review", description: "Review code" },
		];
		const shortened = shortenSkillSuggestions(items, "/code", skills);
		assert.deepEqual(shortened, [
			{ value: "copy", label: "copy" },
			{ value: "code-review", label: "code-review", description: "Review code" },
		]);
		assert.deepEqual(shortenSkillSuggestions(items, "/skill:code", skills), items);
	});

	it("does not steal a name that is already in the menu", () => {
		const items = [
			{ value: "fix-tests", label: "fix-tests" },
			{ value: "skill:fix-tests", label: "skill:fix-tests" },
		];
		assert.deepEqual(shortenSkillSuggestions(items, "/", skills), items);
	});

	it("does not rewrite file or argument completions", () => {
		const items = [{ value: "skill:code-review", label: "skill:code-review" }];
		assert.deepEqual(shortenSkillSuggestions(items, "@src", skills), items);
		assert.deepEqual(shortenSkillSuggestions(items, "/code-review ", skills), items);
	});
});
