import { HEADER_PAD_Y, LOGO_INTERVAL_MS, LOGO_LEFT_PAD, LOGO_TEXT_GAP, SLOGAN } from "../config.ts";
import { ellipsizeMiddle, fallbackIfStale, formatHomePath, internLines, modelLabel, paintModelThinking } from "../utils.ts";
import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { LAST_LOGO_FRAME, logoColumnWidth, renderLogoFrame } from "./logo.ts";

export function formatHeaderPath(cwd: string, maxWidth: number, home?: string): string {
	const path = formatHomePath(cwd, home);
	if (maxWidth <= 0) return path;
	return ellipsizeMiddle(path, maxWidth);
}

export function padHeaderVertically(lines: string[], padY = HEADER_PAD_Y): string[] {
	if (padY <= 0) return lines;
	const blank = Array.from({ length: padY }, () => "");
	return [...blank, ...lines, ...blank];
}

function pad(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

class CraftHeader implements Component {
	private frame: number;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly cache: { lines?: string[] } = {};

	private readonly tui: TUI;
	private readonly ctx: ExtensionContext;
	private readonly pi: ExtensionAPI;

	constructor(tui: TUI, ctx: ExtensionContext, pi: ExtensionAPI, playAnimation: boolean) {
		this.tui = tui;
		this.ctx = ctx;
		this.pi = pi;
		this.frame = playAnimation ? 0 : LAST_LOGO_FRAME;
		if (playAnimation) this.schedule();
	}

	private schedule(): void {
		this.timer = setTimeout(() => {
			if (this.frame < LAST_LOGO_FRAME) {
				this.frame += 1;
				this.tui.requestRender();
				this.schedule();
			} else {
				this.timer = undefined;
				this.tui.requestRender();
			}
		}, LOGO_INTERVAL_MS);
		this.timer.unref?.();
	}

	render(width: number): string[] {
		return internLines(this.cache, fallbackIfStale(() => this.paint(width), []));
	}

	private paint(width: number): string[] {
		const theme = this.ctx.ui.theme;
		const muted = (text: string) => theme.fg("muted", text);
		const logo = renderLogoFrame(this.frame, theme);
		const logoWidth = logoColumnWidth();
		const inset = LOGO_LEFT_PAD + logoWidth + LOGO_TEXT_GAP;
		const infoWidth = Math.max(0, width - inset);
		const model = modelLabel(this.ctx.model?.name, this.ctx.model?.id);
		const info = [
			theme.fg("text", "Pi ") + muted(`v${VERSION}`),
			theme.fg("text", SLOGAN),
			paintModelThinking(model, this.pi.getThinkingLevel(), theme, "muted"),
			muted(formatHeaderPath(this.ctx.cwd, infoWidth)),
		].map((row) => pad(row, infoWidth));

		const leftPad = " ".repeat(LOGO_LEFT_PAD);
		const gap = " ".repeat(LOGO_TEXT_GAP);
		const lines: string[] = [];
		const rows = Math.max(logo.length, info.length);
		for (let i = 0; i < rows; i++) {
			const left = pad(logo[i] ?? "", logoWidth);
			const right = info[i] ?? "";
			lines.push(truncateToWidth(`${leftPad}${left}${gap}${right}`, width, ""));
		}
		return padHeaderVertically(lines);
	}

	invalidate(): void {
		this.cache.lines = undefined;
	}

	dispose(): void {
		if (this.timer != undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}
}

export function installHeader(ctx: ExtensionContext, pi: ExtensionAPI, playAnimation: boolean): void {
	ctx.ui.setHeader((tui) => new CraftHeader(tui, ctx, pi, playAnimation));
}
