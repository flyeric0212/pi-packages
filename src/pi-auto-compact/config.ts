import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export const DEFAULT_TRIGGER_PERCENT = 80;

export interface LoadConfigOptions {
	readonly cwd?: string;
	readonly projectTrusted?: boolean;
	readonly customFilePath?: string;
	/** Test hook: use these paths instead of normal discovery. */
	readonly paths?: string[];
	readonly onDiagnostic?: (message: string) => void;
}

/** Configuration files from lowest to highest precedence. */
export function getCandidateConfigPaths(options: LoadConfigOptions = {}): string[] {
	if (options.paths) return options.paths.map((filePath) => path.resolve(filePath));
	if (options.customFilePath) return [path.resolve(options.customFilePath)];

	const result = [path.join(getAgentDir(), "extensions", "pi-auto-compact", "config.json")];
	if (options.projectTrusted) {
		result.push(path.join(options.cwd ?? process.cwd(), CONFIG_DIR_NAME, "pi-auto-compact.json"));
	}
	return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function isValidPercent(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 50 && value <= 95;
}

/** Load the one extension setting once per session. Invalid overrides are ignored. */
export function loadTriggerPercent(options: LoadConfigOptions = {}): number {
	let triggerPercent = DEFAULT_TRIGGER_PERCENT;

	for (const filePath of getCandidateConfigPaths(options)) {
		if (!fs.existsSync(filePath)) continue;
		try {
			const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
			if (!isPlainObject(parsed)) {
				options.onDiagnostic?.(`Ignoring invalid auto-compact config: ${filePath}`);
				continue;
			}
			if (parsed.autoCompact === undefined) continue;
			if (!isPlainObject(parsed.autoCompact)) {
				options.onDiagnostic?.(`Ignoring invalid autoCompact section: ${filePath}`);
				continue;
			}

			const value = parsed.autoCompact.triggerPercent;
			if (value === undefined) continue;
			if (!isValidPercent(value)) {
				options.onDiagnostic?.(`Invalid triggerPercent in ${filePath}; expected a number from 50 to 95`);
				continue;
			}
			triggerPercent = value;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			options.onDiagnostic?.(`Unable to load auto-compact config '${filePath}': ${detail}`);
		}
	}

	return triggerPercent;
}
