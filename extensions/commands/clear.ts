import { CHROME_LEFT_PAD } from "../config.ts";
import { isStaleExtensionError } from "../utils.ts";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const CLS_CUSTOM_TYPE = "craft-cls";
export const CLS_CHROME_ROWS = 6;
export const CLS_MIN_FILL_ROWS = 8;
export const CLS_FALLBACK_TERMINAL_ROWS = 24;

export type ClearTheme = {
	fg(color: string, text: string): string;
};

export type ClearBranchEntry = {
	id: string;
	type: string;
	customType?: string;
};

export function terminalRows(): number {
	return process.stdout.rows ?? CLS_FALLBACK_TERMINAL_ROWS;
}

export function spacerRows(
	rows: number,
	chromeRows = CLS_CHROME_ROWS,
	minRows = CLS_MIN_FILL_ROWS,
): number {
	const terminal = Number.isFinite(rows) ? Math.floor(rows) : CLS_FALLBACK_TERMINAL_ROWS;
	return Math.max(minRows, Math.max(0, terminal) - chromeRows);
}

/** Live session reads used from TUI render must not throw after /reload. */
export function sessionBranchOrEmpty(
	manager: { getBranch(): readonly ClearBranchEntry[] } | undefined,
): readonly ClearBranchEntry[] {
	if (!manager) return [];
	try {
		return manager.getBranch();
	} catch (error) {
		if (isStaleExtensionError(error)) return [];
		throw error;
	}
}

export function lastClearId(branch: readonly ClearBranchEntry[]): string | undefined {
	let id: string | undefined;
	for (const entry of branch) {
		if (entry.type === "custom" && entry.customType === CLS_CUSTOM_TYPE) id = entry.id;
	}
	return id;
}

type ClearManager = {
	getBranch(): readonly ClearBranchEntry[];
	getLeafId(): string | null;
};

function safeLeafId(manager: ClearManager | undefined): string | null | undefined {
	if (!manager) return undefined;
	try {
		return manager.getLeafId();
	} catch (error) {
		if (isStaleExtensionError(error)) return undefined;
		throw error;
	}
}

/** Fill the viewport only for the newest clear that still sits at the branch tip. */
export function shouldFillViewport(entryId: string, branch: readonly ClearBranchEntry[]): boolean {
	if (lastClearId(branch) !== entryId) return false;
	const index = branch.findIndex((entry) => entry.id === entryId);
	if (index < 0) return false;
	for (let i = index + 1; i < branch.length; i++) {
		if (branch[i]?.type === "message") return false;
	}
	return true;
}

export function paintClear(
	width: number,
	options: { fill: boolean; terminalRows: number; theme: ClearTheme },
): string[] {
	const inner = Math.max(1, width - CHROME_LEFT_PAD);
	const rule = `${" ".repeat(CHROME_LEFT_PAD)}${options.theme.fg("dim", "─".repeat(inner))}`;
	const line = truncateToWidth(rule, Math.max(0, width), "");
	if (!options.fill) return [line];
	const blanks = Math.max(0, spacerRows(options.terminalRows) - 1);
	return [line, ...Array.from({ length: blanks }, () => "")];
}

type ClearData = { at: number };

const DESCRIPTION = "Clear the screen without deleting the session";

/**
 * The session branch is append-only: the leaf id is its fingerprint. While the
 * leaf id, width, and terminal rows are unchanged, the fill decision and the
 * painted lines cannot change, so reuse the last painted result instead of
 * walking the whole branch again.
 */
export class ClearView implements Component {
	private readonly entryId: string;
	private readonly theme: ClearTheme;
	private readonly manager: () => ClearManager | undefined;
	private cachedLeafId: string | null | undefined;
	private cachedWidth = -1;
	private cachedRows = -1;
	private cachedLines: string[] | undefined;

	constructor(entryId: string, theme: ClearTheme, manager: () => ClearManager | undefined) {
		this.entryId = entryId;
		this.theme = theme;
		this.manager = manager;
	}

	render(width: number): string[] {
		const leafId = safeLeafId(this.manager());
		const rows = terminalRows();
		if (
			leafId !== undefined &&
			this.cachedLeafId === leafId &&
			this.cachedWidth === width &&
			this.cachedRows === rows &&
			this.cachedLines
		) {
			return this.cachedLines;
		}
		const lines = paintClear(width, {
			fill: shouldFillViewport(this.entryId, sessionBranchOrEmpty(this.manager())),
			terminalRows: rows,
			theme: this.theme,
		});
		if (leafId !== undefined) {
			this.cachedLeafId = leafId;
			this.cachedWidth = width;
			this.cachedRows = rows;
			this.cachedLines = lines;
		}
		return lines;
	}

	invalidate(): void {}
}

export function installClear(pi: ExtensionAPI): void {
	let manager: ClearManager | undefined;

	pi.on("session_start", (_event, ctx) => {
		manager = ctx.sessionManager;
	});

	pi.on("session_shutdown", () => {
		manager = undefined;
	});

	pi.registerEntryRenderer<ClearData>(CLS_CUSTOM_TYPE, (entry, _options, theme) => {
		return new ClearView(entry.id, theme, () => manager);
	});

	const handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui") return;
		pi.appendEntry<ClearData>(CLS_CUSTOM_TYPE, { at: Date.now() });
	};

	pi.registerCommand("clear", { description: DESCRIPTION, handler });
	pi.registerCommand("cls", { description: DESCRIPTION, handler });
}
