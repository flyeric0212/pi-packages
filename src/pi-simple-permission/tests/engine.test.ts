import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluatePermission } from "../engine.ts";
import type { PermissionConfig } from "../config.ts";

const testConfig: PermissionConfig = {
	permission: {
		"*": "allow",
		path: {
			"*": "allow",
			"*.env": "deny",
			"*.env.*": "deny",
			"*.env.example": "allow",
			"*.env.development": "allow",
		},
		bash: {
			"*": "allow",
			"rm -rf *": "deny",
			"sudo *": "ask",
			"*gradlew*bootRun*": "ask",
			"pnpm dev*": "ask",
			"git push*": "ask",
		},
		external_directory: {
			"*": "allow",
			"~/.ssh/*": "deny",
		},
	},
};

describe("engine", () => {
	describe("bash tool evaluation", () => {
		it("allows standard commands under * rule", () => {
			const res = evaluatePermission("bash", { command: "git status -s" }, testConfig);
			assert.equal(res.action, "allow");
		});

		it("allows safe xargs and pipeline commands without blocking or asking", () => {
			const res1 = evaluatePermission("bash", { command: "find . -name '*.ts' | xargs grep 'TODO'" }, testConfig);
			assert.equal(res1.action, "allow");

			const res2 = evaluatePermission("bash", { command: "cat list.txt | xargs -n 1 wc -l" }, testConfig);
			assert.equal(res2.action, "allow");
		});

		it("blocks dangerous commands matching direct deny rule", () => {
			const res = evaluatePermission("bash", { command: "rm -rf /tmp/test" }, testConfig);
			assert.equal(res.action, "deny");
			assert.match(res.reason ?? "", /rm -rf/);
		});

		it("blocks dangerous commands wrapped inside xargs (find . | xargs rm -rf .)", () => {
			const res1 = evaluatePermission("bash", { command: "find . | xargs rm -rf ." }, testConfig);
			assert.equal(res1.action, "deny");
			assert.match(res1.reason ?? "", /rm -rf/);

			const res2 = evaluatePermission("bash", { command: "find . -name '*.tmp' | xargs -I {} rm -rf {}" }, testConfig);
			assert.equal(res2.action, "deny");
		});

		it("blocks dangerous commands inside command substitutions ($(rm -rf /))", () => {
			const res = evaluatePermission("bash", { command: "echo $(rm -rf /)" }, testConfig);
			assert.equal(res.action, "deny");
			assert.match(res.reason ?? "", /rm -rf/);
		});

		it("blocks dangerous commands wrapped inside sudo / env", () => {
			const res1 = evaluatePermission("bash", { command: "sudo rm -rf /var/log" }, testConfig);
			assert.equal(res1.action, "deny");

			const res2 = evaluatePermission("bash", { command: "env FORCE=1 rm -rf ./cache" }, testConfig);
			assert.equal(res2.action, "deny");
		});

		it("blocks normalized and shell-wrapped dangerous commands", () => {
			for (const command of [
				"echo ok & rm -rf /tmp/x",
				"sh -c 'rm -rf /tmp/x'",
				"eval 'rm -rf /tmp/x'",
				"/bin/rm -rf /tmp/x",
				"rm\t-rf /tmp/x",
				"X=1 rm -rf /tmp/x",
				"(rm -rf /tmp/x)",
				"find . | xargs sh -c 'rm -rf /tmp/x'",
				"timeout 5 rm -rf /tmp/x",
				"exec -a fake rm -rf /tmp/x",
				"env -u HOME rm -rf /tmp/x",
			]) {
				assert.equal(evaluatePermission("bash", { command }, testConfig).action, "deny", command);
			}
		});

		it("does not treat quoted or escaped substitutions as executable", () => {
			assert.equal(evaluatePermission("bash", { command: "echo '$(rm -rf /tmp/x)'" }, testConfig).action, "allow");
			assert.equal(evaluatePermission("bash", { command: "echo \\$(rm -rf /tmp/x)" }, testConfig).action, "allow");
		});

		it("asks for confirmation on sensitive wrapped commands", () => {
			const res = evaluatePermission("bash", { command: "xargs git push origin" }, testConfig);
			assert.equal(res.action, "ask");
			assert.match(res.reason ?? "", /git push/);
			assert.match(res.reason ?? "", /Full command/);

			assert.equal(evaluatePermission("bash", { command: "xargs sudo apt update" }, testConfig).action, "ask");
			assert.equal(evaluatePermission("bash", { command: "env sudo apt update" }, testConfig).action, "ask");
		});

		it("blocks chained commands when any sub-command is dangerous", () => {
			const res = evaluatePermission("bash", { command: "echo 'hello' && rm -rf /var/data" }, testConfig);
			assert.equal(res.action, "deny");
			assert.match(res.reason ?? "", /rm -rf/);
		});

		it("asks for confirmation on sensitive direct commands", () => {
			const res1 = evaluatePermission("bash", { command: "sudo apt update" }, testConfig);
			assert.equal(res1.action, "ask");

			const res2 = evaluatePermission("bash", { command: "git push origin main" }, testConfig);
			assert.equal(res2.action, "ask");

			const res3 = evaluatePermission("bash", { command: "./gradlew bootRun --debug" }, testConfig);
			assert.equal(res3.action, "ask");
		});

		it("prefers deny over ask in chained commands", () => {
			const res = evaluatePermission("bash", { command: "sudo apt update && rm -rf /" }, testConfig);
			assert.equal(res.action, "deny");
		});
	});

	describe("file path evaluation (read, write, edit)", () => {
		it("blocks sensitive .env files", () => {
			const res1 = evaluatePermission("read", { path: "secrets.env" }, testConfig);
			assert.equal(res1.action, "deny");

			const res2 = evaluatePermission("write", { filePath: "/app/prod.env.local" }, testConfig);
			assert.equal(res2.action, "deny");
		});

		it("blocks sensitive files case-insensitively", () => {
			const res = evaluatePermission("read", { path: "SECRET.ENV" }, testConfig);
			assert.equal(res.action, "deny");
		});

		it("allows whitelisted .env.example and .env.development", () => {
			const res1 = evaluatePermission("read", { path: "app.env.example" }, testConfig);
			assert.equal(res1.action, "allow");

			const res2 = evaluatePermission("edit", { path: "app.env.development" }, testConfig);
			assert.equal(res2.action, "allow");
		});

		it("blocks external ssh directory with absolute and model-prefixed paths", () => {
			const res1 = evaluatePermission("read", { path: "~/.ssh/id_rsa" }, testConfig);
			assert.equal(res1.action, "deny");
			assert.match(res1.reason ?? "", /external directory/);

			assert.equal(evaluatePermission("ls", { path: "~/.ssh" }, testConfig).action, "deny");
			assert.equal(evaluatePermission("read", { path: "@~/.ssh/id_rsa" }, testConfig).action, "deny");
		});

		it("checks batch array of files and denies if any is sensitive", () => {
			const res = evaluatePermission("read", { files: ["index.ts", "production.env"] }, testConfig);
			assert.equal(res.action, "deny");
		});

		it("honors absolute path rules after a wildcard fallback", () => {
			const config: PermissionConfig = {
				permission: { "*": "allow", path: { "*": "allow", "/tmp/secret/*": "deny" } },
			};
			assert.equal(evaluatePermission("read", { path: "/tmp/secret/key" }, config).action, "deny");
		});

		it("prefers deny over ask across a batch of paths", () => {
			const config: PermissionConfig = {
				permission: { "*": "allow", path: { "*": "allow", "ask.txt": "ask", "deny.txt": "deny" } },
			};
			assert.equal(evaluatePermission("read", { files: ["ask.txt", "deny.txt"] }, config).action, "deny");
		});

		it("allows standard project files", () => {
			const res = evaluatePermission("read", { path: "src/index.ts" }, testConfig);
			assert.equal(res.action, "allow");
		});
	});

	describe("other tools", () => {
		it("allows standard tools under global * allow rule", () => {
			assert.equal(evaluatePermission("grep", { query: "foo" }, testConfig).action, "allow");
			assert.equal(evaluatePermission("find", { pattern: "*.ts" }, testConfig).action, "allow");
			assert.equal(evaluatePermission("ls", {}, testConfig).action, "allow");
		});

		it("uses the global fallback when a category has no wildcard", () => {
			const config: PermissionConfig = {
				permission: { "*": "deny", bash: { "git status": "allow" } },
			};
			assert.equal(evaluatePermission("bash", { command: "git status" }, config).action, "allow");
			assert.equal(evaluatePermission("bash", { command: "pwd" }, config).action, "deny");
			assert.equal(evaluatePermission("ls", {}, config).action, "deny");
		});
	});
});
