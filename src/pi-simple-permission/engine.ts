import path from "node:path";
import {
	compileWildcardPatterns,
	expandHomePath,
	findCompiledWildcardMatch,
	findCompiledWildcardMatchAny,
	type CompiledWildcardPattern,
	type WildcardPatternMatch,
} from "./matcher.ts";
import { splitBashCommands, unwrapCommandLayers } from "./splitter.ts";
import type { PermissionAction, PermissionConfig, PermissionSubRules } from "./config.ts";

export interface EvaluationResult {
	readonly action: PermissionAction;
	readonly reason?: string;
	readonly matchedPattern?: string;
	readonly matchedCommand?: string;
}

const compiledRuleCache = new WeakMap<PermissionSubRules, CompiledWildcardPattern<PermissionAction>[]>();

function compiledRules(rules: PermissionSubRules): CompiledWildcardPattern<PermissionAction>[] {
	const cached = compiledRuleCache.get(rules);
	if (cached) return cached;
	const compiled = compileWildcardPatterns(rules);
	compiledRuleCache.set(rules, compiled);
	return compiled;
}

function safeAction(value: unknown, fallback: PermissionAction = "deny"): PermissionAction {
	return value === "allow" || value === "deny" || value === "ask" ? value : fallback;
}

function extractPathsFromInput(input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	const record = input as Record<string, unknown>;
	const paths: string[] = [];

	for (const key of [
		"path", "filePath", "targetPath", "TargetFile", "SearchPath", "DirectoryPath", "file", "dir", "directory",
	]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) paths.push(value.trim());
	}
	for (const key of ["paths", "files", "directories", "TargetFiles"]) {
		const value = record[key];
		if (!Array.isArray(value)) continue;
		for (const item of value) {
			if (typeof item === "string" && item.trim()) paths.push(item.trim());
		}
	}
	return paths;
}

function extractCommandFromInput(input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	const record = input as Record<string, unknown>;
	for (const key of ["command", "cmd", "CommandLine"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function strongestMatch(
	matches: readonly (WildcardPatternMatch<PermissionAction> | null)[],
): WildcardPatternMatch<PermissionAction> | null {
	return matches.find((match) => match?.state === "deny")
		?? matches.find((match) => match?.state === "ask")
		?? matches.find((match) => match?.state === "allow")
		?? null;
}

function normalizeToolPath(rawPath: string): string {
	// Pi's built-in path tools strip a model-generated leading @ before resolving.
	return rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
}

/** Evaluates a tool call using deterministic ordered wildcard rules. */
export function evaluatePermission(
	toolName: string,
	input: unknown,
	config: PermissionConfig,
	cwd: string = process.cwd(),
): EvaluationResult {
	const globalFallback = safeAction(config.permission["*"], "allow");

	if (toolName === "bash") {
		const commandLine = extractCommandFromInput(input);
		if (!commandLine) return { action: globalFallback };

		const bashRules = config.permission.bash ?? { "*": globalFallback };
		const compiledBashRules = compiledRules(bashRules);
		const subCommands = splitBashCommands(commandLine);
		if (subCommands.length === 0) return { action: globalFallback };

		let firstAsk: { match: WildcardPatternMatch<PermissionAction> | null; command: string } | undefined;
		for (const subCommand of subCommands) {
			const candidates = [...new Set([subCommand, ...unwrapCommandLayers(subCommand)])];
			for (const candidate of candidates) {
				const match = findCompiledWildcardMatch(compiledBashRules, candidate);
				const action = safeAction(match?.state, safeAction(bashRules["*"], globalFallback));
				if (action === "deny") {
					return {
						action: "deny",
						reason: `Command is blocked by rule '${match?.matchedPattern ?? "bash.*"}': "${candidate}"`,
						matchedPattern: match?.matchedPattern,
						matchedCommand: candidate,
					};
				}
				if (action === "ask" && !firstAsk) firstAsk = { match, command: candidate };
			}
		}

		if (firstAsk) {
			return {
				action: "ask",
				reason: [
					`Rule '${firstAsk.match?.matchedPattern ?? "bash.*"}' requires confirmation for: "${firstAsk.command}"`,
					`Full command: ${commandLine}`,
				].join("\n"),
				matchedPattern: firstAsk.match?.matchedPattern,
				matchedCommand: firstAsk.command,
			};
		}
		return { action: "allow" };
	}

	const targetPaths = extractPathsFromInput(input);
	if (targetPaths.length > 0) {
		const externalRules = config.permission.external_directory
			? compiledRules(config.permission.external_directory)
			: undefined;
		const pathRules = config.permission.path ? compiledRules(config.permission.path) : undefined;
		let firstAsk: { pattern?: string; rawPath: string; category: "path" | "external directory" } | undefined;

		for (const originalPath of targetPaths) {
			const rawPath = normalizeToolPath(originalPath);
			const expandedPath = expandHomePath(rawPath);
			const resolvedPath = path.isAbsolute(expandedPath)
				? path.normalize(expandedPath)
				: path.resolve(cwd, expandedPath);

			const externalMatch = externalRules
				? findCompiledWildcardMatchAny(externalRules, [resolvedPath, expandedPath])
				: null;
			const fileMatch = pathRules
				? findCompiledWildcardMatchAny(pathRules, [path.basename(resolvedPath), resolvedPath])
				: null;
			const strongest = strongestMatch([externalMatch, fileMatch]);
			if (!strongest) continue;

			const category = strongest === externalMatch ? "external directory" : "path";
			if (strongest.state === "deny") {
				return {
					action: "deny",
					reason: `Access to ${category} is blocked by rule '${strongest.matchedPattern}': "${originalPath}"`,
					matchedPattern: strongest.matchedPattern,
				};
			}
			if (strongest.state === "ask" && !firstAsk) {
				firstAsk = { pattern: strongest.matchedPattern, rawPath: originalPath, category };
			}
		}

		if (firstAsk) {
			return {
				action: "ask",
				reason: `Access to ${firstAsk.category} requires confirmation under rule '${firstAsk.pattern}': "${firstAsk.rawPath}"`,
				matchedPattern: firstAsk.pattern,
			};
		}
	}

	return { action: globalFallback };
}
