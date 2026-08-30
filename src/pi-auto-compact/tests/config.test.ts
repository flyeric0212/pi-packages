import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_TRIGGER_PERCENT, getCandidateConfigPaths, loadTriggerPercent } from "../config.ts";

function writeConfig(directory: string, value: unknown, name = "config.json"): string {
	const filePath = path.join(directory, name);
	fs.writeFileSync(filePath, JSON.stringify(value));
	return filePath;
}

describe("trigger percentage config", () => {
	it("loads global config before a trusted project override", () => {
		const cwd = path.resolve("/tmp/pi-auto-compact-project");
		assert.deepEqual(getCandidateConfigPaths({ cwd, projectTrusted: true }), [
			path.join(getAgentDir(), "extensions", "pi-auto-compact", "config.json"),
			path.join(cwd, ".pi/pi-auto-compact.json"),
		]);
		assert.equal(getCandidateConfigPaths({ cwd, projectTrusted: false }).length, 1);
	});

	it("uses 80 when config is missing or empty", () => {
		assert.equal(
			loadTriggerPercent({ customFilePath: path.join(os.tmpdir(), "missing-pi-auto-compact-config.json") }),
			DEFAULT_TRIGGER_PERCENT,
		);
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-config-"));
		try {
			assert.equal(loadTriggerPercent({ customFilePath: writeConfig(directory, {}) }), DEFAULT_TRIGGER_PERCENT);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("loads the configured percentage and applies later-file precedence", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-config-"));
		try {
			const globalFile = writeConfig(directory, { autoCompact: { triggerPercent: 75 } }, "global.json");
			const projectFile = writeConfig(directory, { autoCompact: { triggerPercent: 85 } }, "project.json");
			assert.equal(loadTriggerPercent({ paths: [globalFile, projectFile] }), 85);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("ignores invalid overrides and keeps the last valid percentage", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-config-"));
		const diagnostics: string[] = [];
		try {
			const valid = writeConfig(directory, { autoCompact: { triggerPercent: 70 } }, "valid.json");
			const invalid = writeConfig(directory, { autoCompact: { triggerPercent: 99 } }, "invalid.json");
			assert.equal(loadTriggerPercent({ paths: [valid, invalid], onDiagnostic: (message) => diagnostics.push(message) }), 70);
			assert.equal(diagnostics.length, 1);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("ignores obsolete fields and loads the shipped minimal example", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ac-config-"));
		try {
			const old = writeConfig(directory, {
				autoCompact: { triggerPercent: 74, interruptTurn: true, notifyOnly: true, lang: "en" },
			});
			assert.equal(loadTriggerPercent({ customFilePath: old }), 74);
			assert.equal(
				loadTriggerPercent({ customFilePath: path.resolve("src/pi-auto-compact/config.example.json") }),
				80,
			);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
});
