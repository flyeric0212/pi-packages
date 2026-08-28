import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { MessageLang } from "./messages.ts";

export interface AutoCompactSettings {
	enabled: boolean;
	/** Percent of the context window at which auto-compaction triggers (50-95). */
	triggerPercent: number;
	/** Minimum context growth (tokens) since the last auto-compaction before triggering again. */
	debounceTokens: number;
	/** Allow triggering mid-turn (interrupt + compact + resume); false = turn boundaries only. */
	interruptTurn: boolean;
	/** Only notify at the threshold; never compact or resume automatically. */
	notifyOnly: boolean;
	/** Extra instructions appended to the summarization request. */
	customInstructions: string;
	/** Language of user-facing copy (resume prompt + UI notifications). */
	lang: MessageLang;
}

export interface AutoCompactConfig {
	autoCompact: AutoCompactSettings;
}

export interface AutoCompactConfigOverride {
	autoCompact: Partial<AutoCompactSettings>;
}

export const DEFAULT_AUTO_COMPACT_SETTINGS: AutoCompactSettings = {
	enabled: true,
	triggerPercent: 80,
	debounceTokens: 20000,
	interruptTurn: true,
	notifyOnly: false,
	customInstructions:
		"Focus the summary on: 1) the current task goal and acceptance criteria; " +
		"2) unfinished changes with their exact file paths; " +
		"3) key decisions made and the rationale behind them; " +
		"4) concrete next steps. Keep <read-files>/<modified-files> complete and accurate. " +
		"The summary body language may follow the conversation language.",
	lang: "zh",
};

export const DEFAULT_AUTO_COMPACT_CONFIG: AutoCompactConfig = {
	autoCompact: DEFAULT_AUTO_COMPACT_SETTINGS,
};

export interface LoadConfigOptions {
	readonly cwd?: string;
	readonly projectTrusted?: boolean;
	readonly customFilePath?: string;
	/** Test hook: use these paths instead of the default discovery. */
	readonly paths?: string[];
	readonly onDiagnostic?: (message: string) => void;
}

/** Configuration files from lowest to highest precedence. */
export function getCandidateConfigPaths(options: LoadConfigOptions = {}): string[] {
	if (options.paths) return options.paths.map((p) => path.resolve(p));
	if (options.customFilePath) return [path.resolve(options.customFilePath)];

	// Global config lives in pi's agent dir (honors PI_CODING_AGENT_DIR via
	// getAgentDir()), project config in the trusted project's .pi directory.
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

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

const KNOWN_SETTING_KEYS = [
	"enabled",
	"triggerPercent",
	"debounceTokens",
	"interruptTurn",
	"notifyOnly",
	"customInstructions",
	"lang",
] as const;

function isValidSettingValue(key: string, value: unknown): boolean {
	switch (key) {
		case "enabled":
		case "interruptTurn":
		case "notifyOnly":
			return typeof value === "boolean";
		case "triggerPercent":
			return isFiniteNumber(value) && value >= 50 && value <= 95;
		case "debounceTokens":
			return isFiniteNumber(value) && value >= 1000;
		case "customInstructions":
			return typeof value === "string";
		case "lang":
			return value === "zh" || value === "en";
		default:
			return false;
	}
}

/** Strict shape check exposed for callers that need all-or-nothing validation. */
export function isValidAutoCompactConfigFile(value: unknown): value is AutoCompactConfigOverride {
	if (!isPlainObject(value)) return false;
	if (Object.keys(value).some((key) => key !== "autoCompact" && key !== "$schema")) return false;
	const section = value.autoCompact;
	if (section === undefined) return true;
	if (!isPlainObject(section)) return false;
	return Object.keys(section).every((key) => (KNOWN_SETTING_KEYS as readonly string[]).includes(key) && isValidSettingValue(key, section[key]));
}

function normalizeAutoCompactConfigFile(
	value: unknown,
	filePath: string,
	onDiagnostic?: (message: string) => void,
): AutoCompactConfigOverride | null {
	if (!isPlainObject(value) || Object.keys(value).some((key) => key !== "autoCompact" && key !== "$schema")) {
		onDiagnostic?.(`Ignoring invalid auto-compact config shape: ${filePath}`);
		return null;
	}
	if (value.autoCompact === undefined) return { autoCompact: {} };
	if (!isPlainObject(value.autoCompact)) {
		onDiagnostic?.(`Ignoring invalid autoCompact section: ${filePath}`);
		return null;
	}

	const normalized: Partial<AutoCompactSettings> = {};
	for (const [key, settingValue] of Object.entries(value.autoCompact)) {
		if (!(KNOWN_SETTING_KEYS as readonly string[]).includes(key)) {
			onDiagnostic?.(`Ignoring unknown auto-compact setting '${key}' in ${filePath}`);
			continue;
		}
		const settingKey = key as (typeof KNOWN_SETTING_KEYS)[number];
		if (!isValidSettingValue(settingKey, settingValue)) {
			onDiagnostic?.(`Invalid auto-compact setting '${settingKey}' in ${filePath}; using its default`);
			(normalized as Record<string, unknown>)[settingKey] = DEFAULT_AUTO_COMPACT_SETTINGS[settingKey];
			continue;
		}
		(normalized as Record<string, unknown>)[settingKey] = settingValue;
	}
	return { autoCompact: normalized };
}

export function mergeAutoCompactConfigs(base: AutoCompactConfig, override: AutoCompactConfigOverride): AutoCompactConfig {
	return {
		autoCompact: {
			...base.autoCompact,
			...override.autoCompact,
		},
	};
}

/** Loads defaults, then global config, then trusted project config. */
export function loadAutoCompactConfig(options: LoadConfigOptions = {}): AutoCompactConfig {
	let config = DEFAULT_AUTO_COMPACT_CONFIG;

	for (const filePath of getCandidateConfigPaths(options)) {
		if (!fs.existsSync(filePath)) continue;
		try {
			const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
			const normalized = normalizeAutoCompactConfigFile(parsed, filePath, options.onDiagnostic);
			if (!normalized) continue;
			config = mergeAutoCompactConfigs(config, normalized);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			options.onDiagnostic?.(`Unable to load auto-compact config '${filePath}': ${detail}`);
		}
	}

	return config;
}

export interface AutoCompactLoader {
	/** Return the current config, re-reading files only when any candidate changed (hot reload). */
	get(): AutoCompactConfig;
}

/** Hot-reloading loader: re-reads candidate files only when their mtimes change. */
export function createAutoCompactLoader(options: LoadConfigOptions): AutoCompactLoader {
	const paths = getCandidateConfigPaths(options);
	let cacheKey: string | null = null;
	let cached: AutoCompactConfig = DEFAULT_AUTO_COMPACT_CONFIG;

	return {
		get(): AutoCompactConfig {
			let key = "";
			for (const p of paths) {
				try {
					key += `${fs.statSync(p).mtimeMs};`;
				} catch {
					key += "missing;";
				}
			}
			if (key === cacheKey) return cached;
			cacheKey = key;
			cached = loadAutoCompactConfig(options);
			return cached;
		},
	};
}