import type { Theme } from "@earendil-works/pi-coding-agent";

type Phase = "left" | "top" | "right" | "none";
type Cell = "empty" | "accent" | "success" | "error" | "warning" | "text";

type Frame = {
	phase: number;
	active: Phase;
	ax: number;
	ay: number;
	flash: boolean;
	white: boolean;
};

/** Same cell as pi-claude-code-tui; settled π is 4×4 cells in the 7×8 canvas. */
export const LOGO_CELL = "███";
const INK_ROW_START = 3;
const INK_ROW_END = 6;
const INK_COL_START = 2;
const INK_COL_END = 5;
export const LOGO_ROWS = INK_ROW_END - INK_ROW_START + 1;

const FRAMES: Frame[] = [
	...Array.from({ length: 4 }, (_, ay) => ({ phase: 0, active: "left" as const, ax: 2, ay, flash: false, white: false })),
	...Array.from({ length: 3 }, (_, ay) => ({ phase: 1, active: "top" as const, ax: 2, ay, flash: false, white: false })),
	...Array.from({ length: 5 }, (_, ay) => ({ phase: 2, active: "right" as const, ax: 5, ay, flash: false, white: false })),
	{ phase: 3, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 3, active: "none", ax: 0, ay: 0, flash: true, white: false },
	{ phase: 3, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 3, active: "none", ax: 0, ay: 0, flash: true, white: false },
	{ phase: 4, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: "none", ax: 0, ay: 0, flash: false, white: true },
	{ phase: 5, active: "none", ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: "none", ax: 0, ay: 0, flash: false, white: true },
	{ phase: 6, active: "none", ax: 0, ay: 0, flash: false, white: false },
];

const WHITE = new Set(["3,2", "3,3", "3,4", "4,2", "4,4", "5,2", "5,3", "5,5", "6,2", "6,5"]);
const P4_CYAN = new Set(["2,2", "2,3", "2,4", "3,4"]);
const P4_RED = new Set(["3,2", "4,2", "4,3", "5,2"]);
const P4_GREEN = new Set(["4,5", "5,5"]);
const P5_CYAN = new Set(["3,2", "3,3", "3,4", "4,4"]);
const P5_RED = new Set(["4,2", "5,2", "5,3", "6,2"]);
const P5_GREEN = new Set(["5,5", "6,5"]);
const EARLY_ORANGE = new Set(["6,1", "6,2", "6,3", "6,4"]);
const LATE_GREEN = new Set(["4,5", "5,5", "6,5", "6,6"]);
const LEFT: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [2, 0]];
const TOP: Array<[number, number]> = [[0, 0], [0, 1], [0, 2], [1, 2]];
const RIGHT: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [2, 1]];

export const LAST_LOGO_FRAME = FRAMES.length - 1;

function cellAt(frame: Frame, y: number, x: number): Cell {
	const key = `${y},${x}`;
	if (frame.white) return WHITE.has(key) ? "text" : "empty";
	if (frame.flash && y === 6 && x >= 1 && x <= 6) return "warning";
	if (frame.active === "left" && LEFT.some(([dy, dx]) => y === frame.ay + dy && x === frame.ax + dx)) return "error";
	if (frame.active === "top" && TOP.some(([dy, dx]) => y === frame.ay + dy && x === frame.ax + dx)) return "accent";
	if (frame.active === "right" && RIGHT.some(([dy, dx]) => y === frame.ay + dy && x === frame.ax + dx)) return "success";
	if (frame.phase === 6) return WHITE.has(key) ? "accent" : "empty";
	if (frame.phase === 4) {
		if (P4_CYAN.has(key)) return "accent";
		if (P4_RED.has(key)) return "error";
		if (P4_GREEN.has(key)) return "success";
		return "empty";
	}
	if (frame.phase >= 5) {
		if (P5_CYAN.has(key)) return "accent";
		if (P5_RED.has(key)) return "error";
		if (P5_GREEN.has(key)) return "success";
		return "empty";
	}
	if (frame.phase <= 3 && EARLY_ORANGE.has(key)) return "warning";
	if (frame.phase >= 2 && P4_CYAN.has(key)) return "accent";
	if (frame.phase >= 1 && P4_RED.has(key)) return "error";
	if (frame.phase >= 3 && LATE_GREEN.has(key)) return "success";
	return "empty";
}

export function renderLogoFrame(index: number, theme: Theme): string[] {
	const frame = FRAMES[Math.min(Math.max(0, index), LAST_LOGO_FRAME)]!;
	const empty = " ".repeat(LOGO_CELL.length);
	const lines: string[] = [];
	for (let y = INK_ROW_START; y <= INK_ROW_END; y++) {
		let line = "";
		for (let x = INK_COL_START; x <= INK_COL_END; x++) {
			const cell = cellAt(frame, y, x);
			line += cell === "empty" ? empty : theme.fg(cell, LOGO_CELL);
		}
		lines.push(line);
	}
	return lines;
}

export function logoColumnWidth(): number {
	return (INK_COL_END - INK_COL_START + 1) * LOGO_CELL.length;
}
