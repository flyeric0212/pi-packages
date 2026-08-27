const MAX_SUBSTITUTION_DEPTH = 16;

function findClosingParen(text: string, start: number): number {
	let depth = 1;
	let quote: "'" | '"' | "`" | null = null;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i] ?? "";
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(") depth++;
		else if (char === ")" && --depth === 0) return i;
	}
	return -1;
}

/** Extracts executable `$(...)` and backtick substitutions, respecting quoting and escapes. */
export function extractCommandSubstitutions(text: string): string[] {
	const results: string[] = [];
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i] ?? "";
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (char === "'") {
			if (quote !== '"') quote = quote === "'" ? null : "'";
			continue;
		}
		if (char === '"') {
			if (quote !== "'") quote = quote === '"' ? null : '"';
			continue;
		}
		if (quote === "'") continue;

		if (char === "$" && text[i + 1] === "(") {
			const end = findClosingParen(text, i + 2);
			if (end !== -1) {
				const inner = text.slice(i + 2, end).trim();
				if (inner) results.push(inner);
				i = end;
			}
			continue;
		}

		if (char === "`") {
			let end = i + 1;
			let backtickEscaped = false;
			for (; end < text.length; end++) {
				const candidate = text[end] ?? "";
				if (backtickEscaped) {
					backtickEscaped = false;
					continue;
				}
				if (candidate === "\\") {
					backtickEscaped = true;
					continue;
				}
				if (candidate === "`") break;
			}
			if (end < text.length) {
				const inner = text.slice(i + 1, end).trim();
				if (inner) results.push(inner);
				i = end;
			}
		}
	}

	return results;
}

function splitBashCommandsAtDepth(commandLine: string, depth: number): string[] {
	const text = commandLine.trim();
	if (!text) return [];

	const commands: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;
	let comment = false;

	const flush = (): void => {
		if (current.trim()) commands.push(current.trim());
		current = "";
	};

	for (let i = 0; i < text.length; i++) {
		const char = text[i] ?? "";
		const next = text[i + 1] ?? "";
		const previous = text[i - 1] ?? "";

		if (comment) {
			if (char === "\n") {
				comment = false;
				flush();
			}
			continue;
		}
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && next === "$" && text[i + 2] === "(" && quote !== "'") {
			const end = findClosingParen(text, i + 3);
			if (end !== -1) {
				current += text.slice(i, end + 1);
				i = end;
				continue;
			}
		}
		if (char === "\\" && quote !== "'") {
			current += char;
			escaped = true;
			continue;
		}
		if (char === "'") {
			if (quote !== '"') quote = quote === "'" ? null : "'";
			current += char;
			continue;
		}
		if (char === '"') {
			if (quote !== "'") quote = quote === '"' ? null : '"';
			current += char;
			continue;
		}
		if (quote) {
			current += char;
			continue;
		}

		if (char === "$" && next === "(") {
			const end = findClosingParen(text, i + 2);
			if (end !== -1) {
				current += text.slice(i, end + 1);
				i = end;
				continue;
			}
		}
		if (char === "`") {
			const end = text.indexOf("`", i + 1);
			if (end !== -1) {
				current += text.slice(i, end + 1);
				i = end;
				continue;
			}
		}
		if (char === "#" && (!previous || /\s/.test(previous))) {
			comment = true;
			continue;
		}

		const doubleOperator = (char === "&" && next === "&") || (char === "|" && next === "|");
		if (doubleOperator) {
			flush();
			i++;
			continue;
		}
		const singleAmpersand = char === "&" && previous !== ">" && previous !== "<" && next !== ">";
		const singlePipe = char === "|" && previous !== ">";
		if (singleAmpersand || singlePipe || char === ";" || char === "\n" || char === "(" || char === ")") {
			flush();
			continue;
		}

		current += char;
	}
	flush();

	if (depth < MAX_SUBSTITUTION_DEPTH) {
		for (const substitution of extractCommandSubstitutions(text)) {
			commands.push(...splitBashCommandsAtDepth(substitution, depth + 1));
		}
	}
	return commands;
}

/** Splits top-level shell command units and recursively includes executable substitutions. */
export function splitBashCommands(commandLine: string): string[] {
	return splitBashCommandsAtDepth(commandLine, 0);
}

/** Tokenizes a command while preserving quoted arguments as single tokens. */
export function tokenizeCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (const char of command) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			current += char;
			escaped = true;
			continue;
		}
		if (char === "'") {
			if (quote !== '"') quote = quote === "'" ? null : "'";
			current += char;
			continue;
		}
		if (char === '"') {
			if (quote !== "'") quote = quote === '"' ? null : '"';
			current += char;
			continue;
		}
		if (!quote && /\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

const WRAPPER_COMMANDS = new Set([
	"xargs", "sudo", "env", "nohup", "time", "timeout", "nice", "exec", "eval", "command",
	"sh", "bash", "dash", "zsh", "ksh",
]);

const VALUE_TAKING_FLAGS: Record<string, ReadonlySet<string>> = {
	xargs: new Set([
		"-n", "-P", "-I", "-L", "-s", "-E", "-d", "-a",
		"--max-args", "--max-procs", "--replace", "--max-lines", "--max-chars", "--eof",
		"--delimiter", "--arg-file",
	]),
	sudo: new Set(["-u", "-g", "-p", "-C", "-D", "-h", "-R", "-T", "--user", "--group", "--prompt", "--chdir"]),
	env: new Set(["-u", "-C", "-S", "--unset", "--chdir", "--split-string"]),
	timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
	nice: new Set(["-n", "--adjustment"]),
	exec: new Set(["-a"]),
};

const CONTROL_WORDS = new Set(["then", "do", "else", "elif", "{", "!", "time"]);

function isEnvAssignment(token: string | undefined): boolean {
	return Boolean(token && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
}

function unquoteToken(token: string): string {
	if (token.length >= 2) {
		const first = token[0];
		const last = token.at(-1);
		if ((first === "'" || first === '"') && last === first) return token.slice(1, -1);
	}
	return token;
}

function normalizeCommand(command: string): string {
	const tokens = tokenizeCommand(command.trim());
	while (tokens[0] && (isEnvAssignment(tokens[0]) || CONTROL_WORDS.has(tokens[0]))) tokens.shift();
	if (tokens.length === 0) return command.trim();
	const executable = unquoteToken(tokens[0] ?? "");
	tokens[0] = executable.split(/[\\/]/).pop() ?? executable;
	return tokens.join(" ");
}

function consumesNextValue(command: string, token: string): boolean {
	if (token.includes("=")) return false;
	return VALUE_TAKING_FLAGS[command]?.has(token) ?? false;
}

function nextWrappedCommand(command: string): string | null {
	const tokens = tokenizeCommand(command);
	if (tokens.length === 0) return null;
	const wrapper = (tokens[0] ?? "").split(/[\\/]/).pop() ?? "";
	if (!WRAPPER_COMMANDS.has(wrapper)) return null;

	if (wrapper === "eval") {
		return tokens.slice(1).map(unquoteToken).join(" ") || null;
	}

	let index = 1;
	let sawShellCommandFlag = false;
	while (index < tokens.length) {
		const token = tokens[index] ?? "";
		if (token === "--") {
			index++;
			break;
		}
		if (wrapper === "env" && isEnvAssignment(token)) {
			index++;
			continue;
		}
		if (["sh", "bash", "dash", "zsh", "ksh"].includes(wrapper) && (token === "-c" || token === "--command")) {
			sawShellCommandFlag = true;
			index++;
			break;
		}
		if (token.startsWith("-")) {
			index += consumesNextValue(wrapper, token) ? 2 : 1;
			continue;
		}
		break;
	}

	if (wrapper === "timeout") index++; // mandatory duration
	if (index >= tokens.length) return null;
	if (sawShellCommandFlag) return unquoteToken(tokens[index] ?? "");
	return tokens.slice(index).join(" ");
}

/** Returns normalized wrapper layers from outermost to innermost. */
export function unwrapCommandLayers(command: string): string[] {
	const layers: string[] = [];
	let current = normalizeCommand(command);
	for (let depth = 0; depth < 16 && current; depth++) {
		if (layers.at(-1) !== current) layers.push(current);
		const next = nextWrappedCommand(current);
		if (!next) break;
		const normalized = normalizeCommand(next);
		if (!normalized || normalized === current) break;
		current = normalized;
	}
	return layers;
}

/** Returns the innermost recognized command, preserving the legacy helper API. */
export function unwrapCommand(command: string): string {
	return unwrapCommandLayers(command).at(-1) ?? command.trim();
}
