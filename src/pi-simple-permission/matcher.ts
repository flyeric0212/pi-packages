import os from "node:os";

/**
 * A compiled wildcard pattern for fast repeated matching.
 */
export interface CompiledWildcardPattern<TState = string> {
	readonly pattern: string;
	readonly state: TState;
	matches(value: string): boolean;
}

export interface WildcardPatternMatch<TState = string> {
	readonly state: TState;
	readonly matchedPattern: string;
	readonly matchedName: string;
}

export interface CompileOptions {
	readonly caseInsensitive?: boolean;
}

/**
 * Escapes regex special characters in a string.
 */
export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Expands leading `~` or `~/` to user's home directory.
 */
export function expandHomePath(filePath: string): string {
	if (filePath === "~") {
		return os.homedir();
	}
	if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
		return `${os.homedir()}${filePath.slice(1)}`;
	}
	return filePath;
}

/**
 * Compiles a wildcard pattern into a RegExp matcher.
 *
 * Supports:
 * - `*` matches zero or more characters.
 * - A trailing ` *` or `/*` also matches the command/directory itself.
 * - Leading `~` is expanded to the user's home directory.
 */
export function compileWildcardPattern<TState = string>(
	pattern: string,
	state: TState,
	options: CompileOptions = { caseInsensitive: true },
): CompiledWildcardPattern<TState> {
	const expanded = expandHomePath(pattern.trim());
	let escaped = expanded
		.split("*")
		.map((part) => escapeRegExp(part))
		.join(".*");

	// Trailing command/path wildcard also includes the command or directory itself.
	if (escaped.endsWith(" .*")) {
		escaped = `${escaped.slice(0, -3)}( .*)?`;
	} else if (escaped.endsWith("/.*")) {
		escaped = `${escaped.slice(0, -3)}(/.*)?`;
	}

	const flags = options.caseInsensitive ? "si" : "s";
	const regex = new RegExp(`^${escaped}$`, flags);

	return {
		pattern,
		state,
		matches: (value: string) => regex.test(expandHomePath(value.trim())),
	};
}

/**
 * Compiles a dictionary of pattern -> state mappings.
 */
export function compileWildcardPatterns<TState = string>(
	patterns: Record<string, TState>,
	options?: CompileOptions,
): CompiledWildcardPattern<TState>[] {
	return Object.entries(patterns).map(([pattern, state]) =>
		compileWildcardPattern(pattern, state, options),
	);
}

/**
 * Finds the matching pattern. Later specific rules override earlier ones;
 * exact `*` remains a fallback regardless of its JSON position.
 */
export function findCompiledWildcardMatch<TState = string>(
	patterns: readonly CompiledWildcardPattern<TState>[],
	value: string,
): WildcardPatternMatch<TState> | null {
	return findCompiledWildcardMatchAny(patterns, [value]);
}

/** Finds the last rule matching any equivalent representation of a value. */
export function findCompiledWildcardMatchAny<TState = string>(
	patterns: readonly CompiledWildcardPattern<TState>[],
	values: readonly string[],
): WildcardPatternMatch<TState> | null {
	const matchesAny = (pattern: CompiledWildcardPattern<TState>): boolean =>
		values.some((value) => pattern.matches(value));
	// Exact `*` is always a fallback; its JSON position cannot disable specific rules.
	const match = patterns.findLast((pattern) => pattern.pattern.trim() !== "*" && matchesAny(pattern))
		?? patterns.findLast(matchesAny);
	if (!match) return null;
	const matchedName = values.find((value) => match.matches(value)) ?? values[0] ?? "";
	return {
		state: match.state,
		matchedPattern: match.pattern,
		matchedName,
	};
}
