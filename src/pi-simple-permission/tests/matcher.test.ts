import assert from "node:assert/strict";
import { describe, it } from "node:test";
import os from "node:os";
import {
	compileWildcardPattern,
	compileWildcardPatterns,
	findCompiledWildcardMatch,
	escapeRegExp,
	expandHomePath,
} from "../matcher.ts";

describe("matcher", () => {
	describe("escapeRegExp", () => {
		it("escapes regex meta characters properly", () => {
			assert.equal(escapeRegExp("a.b+c?d^e$f(g)[h]{i}|j\\k"), "a\\.b\\+c\\?d\\^e\\$f\\(g\\)\\[h\\]\\{i\\}\\|j\\\\k");
		});
	});

	describe("expandHomePath", () => {
		it("expands home directory symbol", () => {
			const home = os.homedir();
			assert.equal(expandHomePath("~"), home);
			assert.equal(expandHomePath("~/foo/bar"), `${home}/foo/bar`);
			assert.equal(expandHomePath("/var/log"), "/var/log");
		});
	});

	describe("compileWildcardPattern", () => {
		it("matches exact strings", () => {
			const matcher = compileWildcardPattern("git status", "allow");
			assert.equal(matcher.matches("git status"), true);
			assert.equal(matcher.matches("git status -s"), false);
			assert.equal(matcher.matches("git log"), false);
		});

		it("matches case-insensitively by default", () => {
			const matcher = compileWildcardPattern("*.env", "deny");
			assert.equal(matcher.matches("PROD.ENV"), true);
			assert.equal(matcher.matches("production.Env"), true);

			const gitMatcher = compileWildcardPattern("git *", "allow");
			assert.equal(gitMatcher.matches("GIT STATUS"), true);
		});

		it("matches prefix wildcard with trailing space and star", () => {
			const matcher = compileWildcardPattern("git *", "allow");
			assert.equal(matcher.matches("git"), true);
			assert.equal(matcher.matches("git status"), true);
			assert.equal(matcher.matches("git push origin main"), true);
			assert.equal(matcher.matches("gits"), false);
		});

		it("matches file extensions and wildcards", () => {
			const envMatcher = compileWildcardPattern("*.env", "deny");
			assert.equal(envMatcher.matches(".env"), true);
			assert.equal(envMatcher.matches("config.env"), true);
			assert.equal(envMatcher.matches("config.env.example"), false);
			assert.equal(envMatcher.matches("not-an-env"), false);
		});

		it("matches mid-string wildcards", () => {
			const gradleMatcher = compileWildcardPattern("*gradlew*bootRun*", "ask");
			assert.equal(gradleMatcher.matches("./gradlew bootRun"), true);
			assert.equal(gradleMatcher.matches("./gradlew --debug bootRun --stacktrace"), true);
			assert.equal(gradleMatcher.matches("./gradlew test"), false);
		});

		it("treats undocumented question marks literally", () => {
			const matcher = compileWildcardPattern("file?.txt", "deny");
			assert.equal(matcher.matches("file?.txt"), true);
			assert.equal(matcher.matches("file1.txt"), false);
		});

		it("matches home directory path wildcards", () => {
			const home = os.homedir();
			const sshMatcher = compileWildcardPattern("~/.ssh/*", "deny");
			assert.equal(sshMatcher.matches(`${home}/.ssh/id_rsa`), true);
			assert.equal(sshMatcher.matches("~/.ssh/config"), true);
			assert.equal(sshMatcher.matches(`${home}/.gitconfig`), false);
		});
	});

	describe("findCompiledWildcardMatch", () => {
		it("later specific rules override earlier rules", () => {
			const rules = compileWildcardPatterns({
				"*": "allow",
				"*.env": "deny",
				"*.env.*": "deny",
				"*.env.example": "allow",
			});

			const matchDefault = findCompiledWildcardMatch(rules, "foo.txt");
			assert.equal(matchDefault?.state, "allow");

			const matchEnv = findCompiledWildcardMatch(rules, "production.env");
			assert.equal(matchEnv?.state, "deny");
			assert.equal(matchEnv?.matchedPattern, "*.env");

			const matchExample = findCompiledWildcardMatch(rules, "production.env.example");
			assert.equal(matchExample?.state, "allow");
			assert.equal(matchExample?.matchedPattern, "*.env.example");
		});

		it("treats exact * as a fallback regardless of JSON order", () => {
			const rules = compileWildcardPatterns({ "sudo *": "ask", "*": "allow" });
			assert.equal(findCompiledWildcardMatch(rules, "sudo apt update")?.state, "ask");
			assert.equal(findCompiledWildcardMatch(rules, "git status")?.state, "allow");
		});
	});
});
