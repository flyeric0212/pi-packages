import { Box, Text, type Component } from "@earendil-works/pi-tui";
import { TOOL_SHELL_PAD_X, TOOL_SHELL_PAD_Y } from "../config.ts";

const SHELL_SLOT = "__craftShell";
const CALL_CHILD_SLOT = "__craftShellCall";
const RESULT_CHILD_SLOT = "__craftShellResult";
const HIDDEN_SLOT = "__craftShellHidden";

export type ShellTheme = {
	bg(color: string, text: string): string;
};

export type ShellContext = {
	isPartial: boolean;
	isError: boolean;
	state: Record<string, unknown>;
};

/** Boxed `read` only when expanded or on error. Collapsed success is a bare call line. */
export function usesReadShellBox(options: { expanded: boolean; isError: boolean }): boolean {
	return options.expanded || options.isError;
}

function bgFn(theme: ShellTheme, context: ShellContext): (text: string) => string {
	if (context.isPartial) return (text) => theme.bg("toolPendingBg", text);
	if (context.isError) return (text) => theme.bg("toolErrorBg", text);
	return (text) => theme.bg("toolSuccessBg", text);
}

function asComponent(value: unknown): Component | undefined {
	return value && typeof value === "object" ? (value as Component) : undefined;
}

function ensureShell(theme: ShellTheme, context: ShellContext): Box {
	const existing = asComponent(context.state[SHELL_SLOT]);
	if (existing instanceof Box) {
		existing.setBgFn(bgFn(theme, context));
		return existing;
	}
	const box = new Box(TOOL_SHELL_PAD_X, TOOL_SHELL_PAD_Y, bgFn(theme, context));
	context.state[SHELL_SLOT] = box;
	return box;
}

function rebuild(box: Box, context: ShellContext): void {
	box.clear();
	const call = asComponent(context.state[CALL_CHILD_SLOT]);
	const result = asComponent(context.state[RESULT_CHILD_SLOT]);
	if (call) box.addChild(call);
	if (result) box.addChild(result);
}

export function paintShellCall(call: Component, theme: ShellTheme, context: ShellContext): Component {
	const box = ensureShell(theme, context);
	context.state[CALL_CHILD_SLOT] = call;
	rebuild(box, context);
	return box;
}

export function paintShellResult(result: Component, theme: ShellTheme, context: ShellContext): Component {
	const box = ensureShell(theme, context);
	context.state[RESULT_CHILD_SLOT] = result;
	rebuild(box, context);
	const existing = asComponent(context.state[HIDDEN_SLOT]);
	const hidden = existing instanceof Text ? existing : new Text("", 0, 0);
	if (hidden !== existing) {
		hidden.setText("");
		context.state[HIDDEN_SLOT] = hidden;
	}
	return hidden;
}
