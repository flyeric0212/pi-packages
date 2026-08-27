import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionSubRules {
	[pattern: string]: PermissionAction;
}

export interface PermissionConfig {
	permission: {
		"*"?: PermissionAction;
		path?: PermissionSubRules;
		bash?: PermissionSubRules;
		external_directory?: PermissionSubRules;
	};
}

export interface LoadConfigOptions {
	readonly cwd?: string;
	readonly projectTrusted?: boolean;
	readonly customFilePath?: string;
	readonly onDiagnostic?: (message: string) => void;
}

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
	permission: {
		"*": "allow",
		path: {
			"*.env": "deny",
			"*.env.*": "deny",
			"*.env.example": "allow",
			"*.env.development": "allow",
		},
		bash: {
			"rm -rf *": "deny",
			"sudo *": "ask",
			"git push*": "ask",
		},
		external_directory: {
			"~/.ssh": "deny",
			"~/.ssh/*": "deny",
		},
	},
};

const ACTIONS = new Set<PermissionAction>(["allow", "deny", "ask"]);
const RULE_CATEGORIES = ["path", "bash", "external_directory"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function isPermissionAction(value: unknown): value is PermissionAction {
	return typeof value === "string" && ACTIONS.has(value as PermissionAction);
}

/** Returns configuration files from lowest to highest precedence. */
export function getCandidateConfigPaths(options: LoadConfigOptions = {}): string[] {
	if (options.customFilePath) return [path.resolve(options.customFilePath)];

	const agentDir = path.join(os.homedir(), CONFIG_DIR_NAME, "agent");
	const result = [
		path.join(agentDir, "permission.json"),
		path.join(agentDir, "extensions/pi-simple-permission/config.json"),
	];
	if (options.projectTrusted) {
		result.push(path.join(options.cwd ?? process.cwd(), CONFIG_DIR_NAME, "permission.json"));
	}
	return result;
}

/** Deep-merges policy categories while preserving JSON rule order. */
export function mergePermissionConfigs(base: PermissionConfig, override: PermissionConfig): PermissionConfig {
	return {
		permission: {
			...base.permission,
			...override.permission,
			path: mergeRules(base.permission.path, override.permission.path),
			bash: mergeRules(base.permission.bash, override.permission.bash),
			external_directory: mergeRules(
				base.permission.external_directory,
				override.permission.external_directory,
			),
		},
	};
}

function mergeRules(
	base: PermissionSubRules | undefined,
	override: PermissionSubRules | undefined,
): PermissionSubRules | undefined {
	if (!base && !override) return undefined;
	const merged: PermissionSubRules = { ...base };
	for (const [pattern, action] of Object.entries(override ?? {})) {
		// Reinsert overridden rules so the higher-precedence file also owns their order.
		delete merged[pattern];
		merged[pattern] = action;
	}
	return merged;
}

/** Loads defaults, then global policy, then trusted project policy. */
export function loadConfig(optionsOrPath: LoadConfigOptions | string = {}): PermissionConfig {
	const options = typeof optionsOrPath === "string"
		? { customFilePath: optionsOrPath }
		: optionsOrPath;
	let config = mergePermissionConfigs(DEFAULT_PERMISSION_CONFIG, { permission: {} });

	for (const filePath of getCandidateConfigPaths(options)) {
		if (!fs.existsSync(filePath)) continue;
		try {
			const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
			if (!isValidPermissionConfig(parsed)) {
				options.onDiagnostic?.(`Ignoring invalid permission config: ${filePath}`);
				continue;
			}
			config = mergePermissionConfigs(config, parsed);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			options.onDiagnostic?.(`Unable to load permission config '${filePath}': ${detail}`);
		}
	}

	return config;
}

/** Validates the complete runtime shape; invalid actions must never fail open. */
export function isValidPermissionConfig(value: unknown): value is PermissionConfig {
	if (!isPlainObject(value) || !isPlainObject(value.permission)) return false;
	if (Object.keys(value).some((key) => key !== "permission" && key !== "$schema")) return false;

	const permission = value.permission;
	const knownKeys = new Set<string>(["*", ...RULE_CATEGORIES]);
	if (Object.keys(permission).some((key) => !knownKeys.has(key))) return false;
	if (permission["*"] !== undefined && !isPermissionAction(permission["*"])) return false;

	for (const category of RULE_CATEGORIES) {
		const rules = permission[category];
		if (rules === undefined) continue;
		if (!isPlainObject(rules)) return false;
		for (const [pattern, action] of Object.entries(rules)) {
			if (!pattern.trim() || !isPermissionAction(action)) return false;
		}
	}

	return true;
}
