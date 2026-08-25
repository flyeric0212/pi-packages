import { isInvocableSlashName, type SkillCatalog } from "../catalog.ts";

const SGR_RESET = /^\x1b\[0?m$/;

export function leadingSlashToken(text: string): string | undefined {
	const first = text.split("\n", 1)[0] ?? "";
	const match = /^(\s*)\/(\S+)/.exec(first);
	if (!match?.[2]) return undefined;
	return `/${match[2]}`;
}

export function recognizedLeadingCommand(text: string, catalog: SkillCatalog): string | undefined {
	const token = leadingSlashToken(text);
	if (!token) return undefined;
	return isInvocableSlashName(token.slice(1), catalog) ? token : undefined;
}

export function consumeAnsi(text: string, index: number): number | undefined {
	if (text.charCodeAt(index) !== 0x1b) return undefined;
	const next = text[index + 1];
	if (next === "[") {
		let i = index + 2;
		while (i < text.length) {
			const code = text.charCodeAt(i);
			if (code >= 0x40 && code <= 0x7e) return i + 1;
			i += 1;
		}
		return text.length;
	}
	if (next === "_" || next === "]" || next === "P" || next === "^") {
		const bel = text.indexOf("\x07", index + 2);
		if (bel >= 0) return bel + 1;
		const st = text.indexOf("\x1b\\", index + 2);
		if (st >= 0) return st + 2;
		return text.length;
	}
	return Math.min(text.length, index + 2);
}

/** Color the first visible `/command` after leading spaces. ANSI inside the token is preserved. */
export function colorizeLeadingCommand(line: string, token: string, open: string, close: string): string {
	if (!token.startsWith("/") || open.length === 0) return line;

	let index = 0;
	let out = "";
	while (index < line.length) {
		const ansiEnd = consumeAnsi(line, index);
		if (ansiEnd !== undefined) {
			out += line.slice(index, ansiEnd);
			index = ansiEnd;
			continue;
		}
		if (line[index] === " ") {
			out += " ";
			index += 1;
			continue;
		}
		break;
	}

	let matched = 0;
	let coloring = false;
	const startColor = (): void => {
		if (!coloring) {
			out += open;
			coloring = true;
		}
	};
	const stopColor = (): void => {
		if (coloring) {
			out += close;
			coloring = false;
		}
	};

	while (index < line.length && matched < token.length) {
		const ansiEnd = consumeAnsi(line, index);
		if (ansiEnd !== undefined) {
			const seq = line.slice(index, ansiEnd);
			out += seq;
			if (coloring && SGR_RESET.test(seq)) out += open;
			index = ansiEnd;
			continue;
		}
		if (line[index] !== token[matched]) return line;
		startColor();
		out += line[index];
		index += 1;
		matched += 1;
	}

	stopColor();
	if (matched < token.length) return line;
	return out + line.slice(index);
}
