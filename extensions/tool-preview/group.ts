export type ReadCallRef = {
	id: string;
	path: string;
	/** False for a non-read tool that splits a run of reads. */
	read: boolean;
};

export type ReadResultFact = {
	isError: boolean;
	hasImage: boolean;
};

export type LiveRead = {
	id: string;
	expanded: boolean;
	isPartial: boolean;
	isError: boolean;
	hasImage: boolean;
};

export type ReadRole = "standalone" | "leader" | "follower";

export type ReadAssignment = {
	role: ReadRole;
	leaderId: string;
	ids: string[];
	paths: string[];
};

export type BranchEntry = {
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
		toolCallId?: string;
		isError?: boolean;
		toolName?: string;
	};
};

type ThemePaint = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

const READ_INDENT = "     ";

export function readArgPath(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	if (typeof record.path === "string" && record.path.length > 0) return record.path;
	if (typeof record.file_path === "string" && record.file_path.length > 0) return record.file_path;
	return "";
}

export function contentHasImage(content: unknown): boolean {
	if (!Array.isArray(content)) return false;
	return content.some((block) => {
		return Boolean(block && typeof block === "object" && (block as { type?: string }).type === "image");
	});
}

function isToolCall(
	block: unknown,
): block is { type: "toolCall"; id: string; name: string; arguments?: unknown } {
	if (!block || typeof block !== "object") return false;
	const record = block as { type?: string; id?: unknown; name?: unknown };
	return record.type === "toolCall" && typeof record.id === "string" && typeof record.name === "string";
}

export function readCallsInMessage(message: { role?: string; content?: unknown } | undefined): ReadCallRef[] {
	if (message?.role !== "assistant" || !Array.isArray(message.content)) return [];
	const calls: ReadCallRef[] = [];
	for (const block of message.content) {
		if (!isToolCall(block)) continue;
		if (block.name === "read") {
			const path = readArgPath(block.arguments);
			if (!path) {
				calls.push({ id: block.id, path: "", read: false });
				continue;
			}
			calls.push({ id: block.id, path, read: true });
			continue;
		}
		calls.push({ id: block.id, path: "", read: false });
	}
	return calls;
}

const USER_BREAK: ReadCallRef = { id: "", path: "", read: false };

/** Tool calls on the branch in source order. User turns split a run of reads. */
export function readCallsInBranch(entries: readonly BranchEntry[]): ReadCallRef[] {
	const calls: ReadCallRef[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const role = entry.message?.role;
		if (role === "user") {
			if (calls.length > 0 && calls[calls.length - 1] !== USER_BREAK) calls.push(USER_BREAK);
			continue;
		}
		if (role === "assistant") calls.push(...readCallsInMessage(entry.message));
	}
	return calls;
}

export function readCallsAround(
	entries: readonly BranchEntry[],
	toolCallId: string,
	extras: readonly ReadCallRef[] = [],
): ReadCallRef[] {
	const calls = readCallsInBranch(entries);
	const seen = new Set(calls.map((call) => call.id).filter((id) => id.length > 0));
	for (const extra of extras) {
		if (!extra.id || seen.has(extra.id)) continue;
		calls.push(extra);
		seen.add(extra.id);
	}
	if (!seen.has(toolCallId)) return [];
	return calls;
}

export function collectReadResults(entries: readonly BranchEntry[]): Map<string, ReadResultFact> {
	const results = new Map<string, ReadResultFact>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
		results.set(message.toolCallId, {
			isError: message.isError === true,
			hasImage: contentHasImage(message.content),
		});
	}
	return results;
}

export function isGroupableRead(
	id: string,
	ordered: readonly ReadCallRef[],
	results: ReadonlyMap<string, ReadResultFact>,
	live: LiveRead,
): boolean {
	const call = ordered.find((item) => item.id === id);
	if (!call || !call.read || call.path.length === 0) return false;
	if (live.expanded) return false;
	if (id === live.id) return !live.isError && !live.hasImage;
	const result = results.get(id);
	if (result?.isError || result?.hasImage) return false;
	return true;
}

function runContaining(
	ordered: readonly ReadCallRef[],
	results: ReadonlyMap<string, ReadResultFact>,
	live: LiveRead,
): ReadCallRef[] {
	const groupable = ordered.map((call) => isGroupableRead(call.id, ordered, results, live));
	let start = -1;
	for (let i = 0; i <= ordered.length; i++) {
		const on = i < ordered.length && groupable[i] === true;
		if (on && start < 0) start = i;
		if (!on && start >= 0) {
			const run = ordered.slice(start, i);
			if (run.some((call) => call.id === live.id)) return run;
			start = -1;
		}
	}
	return [];
}

export function assignReadRole(
	ordered: readonly ReadCallRef[],
	results: ReadonlyMap<string, ReadResultFact>,
	live: LiveRead,
): ReadAssignment {
	const self = ordered.find((call) => call.id === live.id);
	const fallback: ReadAssignment = {
		role: "standalone",
		leaderId: live.id,
		ids: [live.id],
		paths: self ? [self.path] : [],
	};
	if (!self) return fallback;

	const run = runContaining(ordered, results, live);
	if (run.length < 2) return fallback;

	const leaderId = run[0]!.id;
	const ids = run.map((call) => call.id);
	const paths = run.map((call) => call.path);
	if (live.id === leaderId) {
		return { role: "leader", leaderId, ids, paths };
	}
	return { role: "follower", leaderId, ids, paths };
}

export function formatGroupedReadCall(paths: readonly string[], theme: ThemePaint): string {
	if (paths.length === 0) return "";
	const title = theme.fg("toolTitle", theme.bold("read"));
	return paths
		.map((path, index) => {
			const painted = theme.fg("accent", path);
			return index === 0 ? `${title} ${painted}` : `${READ_INDENT}${painted}`;
		})
		.join("\n");
}
