import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	DEFAULT_PERMISSION_CONFIG,
	getCandidateConfigPaths,
	isValidPermissionConfig,
	loadConfig,
	mergePermissionConfigs,
} from "../config.ts";
import { evaluatePermission } from "../engine.ts";

describe("config", () => {
	it("loads global files before a trusted project override", () => {
		const cwd = path.resolve("/tmp/pi-permission-project");
		const paths = getCandidateConfigPaths({ cwd, projectTrusted: true });
		assert.deepEqual(paths, [
			path.join(os.homedir(), ".pi/agent/permission.json"),
			path.join(os.homedir(), ".pi/agent/extensions/pi-simple-permission/config.json"),
			path.join(cwd, ".pi/permission.json"),
		]);
		assert.equal(getCandidateConfigPaths({ cwd, projectTrusted: false }).includes(path.join(cwd, ".pi/permission.json")), false);
	});

	it("validates the complete runtime shape", () => {
		assert.equal(isValidPermissionConfig({ permission: { "*": "allow" } }), true);
		assert.equal(isValidPermissionConfig({ permission: { bash: { "sudo *": "ask" } } }), true);
		assert.equal(isValidPermissionConfig({ permission: { "*": "invalid" } }), false);
		assert.equal(isValidPermissionConfig({ permission: { bash: "allow" } }), false);
		assert.equal(isValidPermissionConfig({ permission: { unknown: { "*": "deny" } } }), false);
		assert.equal(isValidPermissionConfig({}), false);
		assert.equal(isValidPermissionConfig(null), false);
	});

	it("loads and merges a custom file with safe defaults", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-test-"));
		const tempFile = path.join(tempDir, "custom-perm.json");
		fs.writeFileSync(tempFile, JSON.stringify({ permission: { "*": "deny", bash: { "git status": "allow" } } }));

		try {
			const config = loadConfig(tempFile);
			assert.equal(config.permission["*"], "deny");
			assert.equal(config.permission.bash?.["git status"], "allow");
			assert.equal(config.permission.path?.["*.env"], "deny");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("merges category rules without dropping the base policy", () => {
		const merged = mergePermissionConfigs(
			{ permission: { "*": "allow", bash: { "*": "allow", "sudo *": "ask" } } },
			{ permission: { bash: { "rm *": "deny" } } },
		);
		assert.deepEqual(merged.permission.bash, { "*": "allow", "sudo *": "ask", "rm *": "deny" });
	});

	it("keeps specific rules active when a loaded file declares *", () => {
		const config = loadConfig(path.resolve("src/pi-simple-permission/config.example.json"));
		assert.equal(evaluatePermission("bash", { command: "sudo apt update" }, config).action, "ask");
		assert.equal(evaluatePermission("bash", { command: "rm -rf /tmp/x" }, config).action, "deny");
		assert.equal(evaluatePermission("read", { path: "app.env.local" }, config).action, "deny");
	});

	it("reports invalid files and falls back to defaults", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-test-"));
		const tempFile = path.join(tempDir, "invalid.json");
		fs.writeFileSync(tempFile, JSON.stringify({ permission: { "*": "invalid" } }));
		const diagnostics: string[] = [];
		try {
			const config = loadConfig({ customFilePath: tempFile, onDiagnostic: (message) => diagnostics.push(message) });
			assert.deepEqual(config, DEFAULT_PERMISSION_CONFIG);
			assert.equal(diagnostics.length, 1);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
