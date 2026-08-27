import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCommandSubstitutions, splitBashCommands, tokenizeCommand, unwrapCommand } from "../splitter.ts";

describe("splitter", () => {
	describe("extractCommandSubstitutions", () => {
		it("extracts subcommands from $() syntax", () => {
			assert.deepEqual(extractCommandSubstitutions("echo $(rm -rf /)"), ["rm -rf /"]);
			assert.deepEqual(extractCommandSubstitutions("var=$(echo $(whoami))"), ["echo $(whoami)"]);
		});

		it("extracts subcommands from backticks", () => {
			assert.deepEqual(extractCommandSubstitutions("echo `rm -rf /`"), ["rm -rf /"]);
		});

		it("ignores quoted and escaped substitutions", () => {
			assert.deepEqual(extractCommandSubstitutions("echo '$(rm -rf /)'"), []);
			assert.deepEqual(extractCommandSubstitutions("echo \\$(rm -rf /)"), []);
		});
	});

	describe("splitBashCommands", () => {
		it("returns empty array for empty or whitespace string", () => {
			assert.deepEqual(splitBashCommands(""), []);
			assert.deepEqual(splitBashCommands("   "), []);
		});

		it("returns single command when no splitters exist", () => {
			assert.deepEqual(splitBashCommands("git status -s"), ["git status -s"]);
		});

		it("splits pipelines (|)", () => {
			assert.deepEqual(
				splitBashCommands("find . -name '*.ts' | xargs grep foo"),
				["find . -name '*.ts'", "xargs grep foo"],
			);
		});

		it("splits chained and background commands", () => {
			assert.deepEqual(
				splitBashCommands("npm run build && npm test || echo failed; git status\nls -la & pwd"),
				["npm run build", "npm test", "echo failed", "git status", "ls -la", "pwd"],
			);
		});

		it("extracts nested command substitutions as subcommands", () => {
			assert.deepEqual(
				splitBashCommands("echo $(rm -rf /)"),
				["echo $(rm -rf /)", "rm -rf /"],
			);
		});

		it("preserves splitters inside single quotes", () => {
			assert.deepEqual(
				splitBashCommands("echo 'hello | world && test; 123'"),
				["echo 'hello | world && test; 123'"],
			);
		});

		it("preserves splitters inside double quotes", () => {
			assert.deepEqual(
				splitBashCommands('echo "hello | world && test; 123" | cat'),
				['echo "hello | world && test; 123"', "cat"],
			);
		});

		it("handles escaped quotes properly", () => {
			assert.deepEqual(
				splitBashCommands("echo \\\"hello && world\\\""),
				["echo \\\"hello", "world\\\""],
			);
		});
	});

	describe("tokenizeCommand", () => {
		it("tokenizes commands with arguments and quotes", () => {
			assert.deepEqual(tokenizeCommand("xargs -I {} rm -rf '{}'"), ["xargs", "-I", "{}", "rm", "-rf", "'{}'"]);
		});
	});

	describe("unwrapCommand", () => {
		it("unwraps simple xargs commands", () => {
			assert.equal(unwrapCommand("xargs rm -rf ."), "rm -rf .");
			assert.equal(unwrapCommand("xargs grep 'TODO'"), "grep 'TODO'");
		});

		it("unwraps xargs with flags", () => {
			assert.equal(unwrapCommand("xargs -0 -n 1 rm -rf"), "rm -rf");
			assert.equal(unwrapCommand("xargs -I {} rm -rf {}"), "rm -rf {}");
		});

		it("unwraps sudo / env / eval commands", () => {
			assert.equal(unwrapCommand("sudo -u root git push"), "git push");
			assert.equal(unwrapCommand("env FOO=1 BAR=2 rm -rf /"), "rm -rf /");
			assert.equal(unwrapCommand("eval 'rm -rf /'"), "rm -rf /");
		});

		it("unwraps nested wrappers", () => {
			assert.equal(unwrapCommand("sudo xargs rm -rf"), "rm -rf");
			assert.equal(unwrapCommand("xargs sudo apt update"), "apt update");
		});

		it("unwraps shell, timeout, exec, and env command forms", () => {
			assert.equal(unwrapCommand("sh -c 'rm -rf /'"), "rm -rf /");
			assert.equal(unwrapCommand("timeout 5 rm -rf /"), "rm -rf /");
			assert.equal(unwrapCommand("exec -a fake rm -rf /"), "rm -rf /");
			assert.equal(unwrapCommand("env -u HOME rm -rf /"), "rm -rf /");
		});

		it("normalizes assignments, whitespace, groups, and executable paths", () => {
			assert.equal(unwrapCommand("FOO=1 /bin/rm\t-rf /"), "rm -rf /");
			assert.deepEqual(splitBashCommands("(rm -rf /)"), ["rm -rf /"]);
		});

		it("leaves normal non-wrapper commands untouched", () => {
			assert.equal(unwrapCommand("git status"), "git status");
			assert.equal(unwrapCommand("find . -name '*.ts'"), "find . -name '*.ts'");
		});
	});
});
