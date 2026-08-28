import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_AUTO_COMPACT_CONFIG,
	createAutoCompactLoader,
	getCandidateConfigPaths,
	isValidAutoCompactConfigFile,
	loadAutoCompactConfig,
} from "../config.ts";

describe("config", () => {
	it("loads global files before a trusted project override", () => {
		const cwd = path.resolve("/tmp/pi-auto-compact-project");
		const paths = getCandidateConfigPaths({ cwd, projectTrusted: true });
		assert.deepEqual(paths, [
			path.join(getAgentDir(), "extensions", "pi-auto-compact", "config.json"),
			path.join(cwd, ".pi/pi-auto-compact.json"),
		]);
		assert.equal(
			getCandidateConfigPaths({ cwd, projectTrusted: false }).includes(path.join(cwd, ".pi/pi-auto-compact.json")),
			false,
		);
	});

	it("honors PI_CODING_AGENT_DIR when resolving the global config directory", () => {
		const previous = process.env.PI_CODING_AGENT_DIR;
		const customAgentDir = path.join(os.tmpdir(), "pi-agent-dir-override");
		process.env.PI_CODING_AGENT_DIR = customAgentDir;
		try {
			const cwd = path.resolve("/tmp/pi-auto-compact-project");
			const paths = getCandidateConfigPaths({ cwd, projectTrusted: true });
			assert.equal(paths[0], path.join(customAgentDir, "extensions", "pi-auto-compact", "config.json"));
			// Project-local discovery is unaffected by the agent dir override.
			assert.equal(paths[1], path.join(cwd, ".pi/pi-auto-compact.json"));
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});

	it("returns safe defaults when no config file exists", () => {
		const missing = path.join(os.tmpdir(), "no-such-auto-compact-config.json");
		const config = loadAutoCompactConfig({ customFilePath: missing });
		assert.deepEqual(config, DEFAULT_AUTO_COMPACT_CONFIG);
	});

	it("merges a partial file over the defaults", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-test-"));
		const tempFile = path.join(tempDir, "config.json");
		fs.writeFileSync(tempFile, JSON.stringify({ autoCompact: { triggerPercent: 75 } }));

		try {
			const config = loadAutoCompactConfig({ customFilePath: tempFile });
			assert.equal(config.autoCompact.triggerPercent, 75);
			assert.equal(config.autoCompact.enabled, true);
			assert.equal(config.autoCompact.debounceTokens, 20000);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("rejects invalid files and falls back to defaults", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-test-"));
		const tempFile = path.join(tempDir, "invalid.json");
		fs.writeFileSync(tempFile, JSON.stringify({ autoCompact: { triggerPercent: 200 } }));
		const diagnostics: string[] = [];
		try {
			const config = loadAutoCompactConfig({ customFilePath: tempFile, onDiagnostic: (m) => diagnostics.push(m) });
			assert.deepEqual(config, DEFAULT_AUTO_COMPACT_CONFIG);
			assert.equal(diagnostics.length, 1);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("keeps valid fields while invalid fields fall back independently", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-test-"));
		const tempFile = path.join(tempDir, "mixed.json");
		fs.writeFileSync(
			tempFile,
			JSON.stringify({ autoCompact: { enabled: false, triggerPercent: 200, lang: "en", unknownField: true } }),
		);
		const diagnostics: string[] = [];
		try {
			const config = loadAutoCompactConfig({ customFilePath: tempFile, onDiagnostic: (m) => diagnostics.push(m) });
			assert.equal(config.autoCompact.enabled, false);
			assert.equal(config.autoCompact.triggerPercent, 80);
			assert.equal(config.autoCompact.lang, "en");
			assert.equal(diagnostics.length, 2);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("validates ranges and shapes strictly", () => {
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { triggerPercent: 50 } }), true);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { triggerPercent: 95 } }), true);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { triggerPercent: 49 } }), false);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { triggerPercent: 96 } }), false);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { enabled: "yes" } }), false);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { debounceTokens: 500 } }), false);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { customInstructions: 42 } }), false);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { lang: "zh" } }), true);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { lang: "en" } }), true);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { lang: "fr" } }), false);
		assert.equal(isValidAutoCompactConfigFile({ autoCompact: { unknownField: true } }), false);
		assert.equal(isValidAutoCompactConfigFile({ unexpected: {} }), false);
		assert.equal(isValidAutoCompactConfigFile(null), false);
		assert.equal(isValidAutoCompactConfigFile({}), true);
	});

	it("loads the shipped example config", () => {
		const config = loadAutoCompactConfig({
			customFilePath: path.resolve("src/pi-auto-compact/config.example.json"),
		});
		assert.equal(config.autoCompact.enabled, true);
		assert.equal(config.autoCompact.triggerPercent, 80);
		assert.equal(config.autoCompact.debounceTokens, 20000);
		assert.equal(config.autoCompact.interruptTurn, true);
		assert.equal(config.autoCompact.notifyOnly, false);
		assert.equal(config.autoCompact.lang, "zh");
		assert.ok(config.autoCompact.customInstructions.length > 40);
	});

	it("hot-reloads when the file changes", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-test-"));
		const tempFile = path.join(tempDir, "config.json");
		fs.writeFileSync(tempFile, JSON.stringify({ autoCompact: { triggerPercent: 70 } }));
		try {
			const loader = createAutoCompactLoader({ customFilePath: tempFile });
			assert.equal(loader.get().autoCompact.triggerPercent, 70);
			// Unchanged file returns the cached config (same object identity).
			assert.equal(loader.get(), loader.get());
			fs.writeFileSync(tempFile, JSON.stringify({ autoCompact: { triggerPercent: 85 } }));
			assert.equal(loader.get().autoCompact.triggerPercent, 85);
			fs.rmSync(tempFile);
			assert.equal(loader.get().autoCompact.triggerPercent, 80);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});