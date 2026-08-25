import { createBashToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, getAgentDir, keyHint, type ExtensionAPI, type ToolInfo, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Container, Text, type Component } from "@earendil-works/pi-tui";
import { collapsePreviewLines, formatCollapsedPreview, resultText, type PreviewTake, type PreviewTone } from "./preview.ts";
import { paintShellCall, paintShellResult, usesReadShellBox } from "./shell.ts";
import {
	assignReadRole,
	collectReadResults,
	contentHasImage,
	formatGroupedReadCall,
	readArgPath,
	readCallsAround,
	type BranchEntry,
	type LiveRead,
	type ReadAssignment,
	type ReadCallRef,
	type ReadResultFact,
} from "./group.ts";

export const PREVIEW_TOOL_NAMES = ["bash", "grep", "find", "ls"] as const;
export const READ_TOOL_NAME = "read";
export const OVERRIDE_TOOL_NAMES = [...PREVIEW_TOOL_NAMES, READ_TOOL_NAME] as const;

export type PreviewToolName = (typeof PREVIEW_TOOL_NAMES)[number];
export type OverrideToolName = (typeof OVERRIDE_TOOL_NAMES)[number];

export function toolOwnerSource(tools: readonly ToolInfo[], name: string): string | undefined {
	return tools.find((tool) => tool.name === name)?.sourceInfo.source;
}

export function shouldOverrideBuiltinPreview(tools: readonly ToolInfo[], name: string): boolean {
	return toolOwnerSource(tools, name) === "builtin";
}

export function isPreviewTool(name: string): name is PreviewToolName {
	return (PREVIEW_TOOL_NAMES as readonly string[]).includes(name);
}

export function listOverridableTools<T extends string>(pi: ExtensionAPI, names: readonly T[]): T[] {
	let tools: ToolInfo[] = [];
	try {
		tools = pi.getAllTools();
	} catch {
		tools = [];
	}
	return names.filter((name) => shouldOverrideBuiltinPreview(tools, name));
}

type AnyToolDefinition = ToolDefinition<any, any, any>;
type BuiltinName = PreviewToolName | typeof READ_TOOL_NAME;

type RenderContext = {
	args: Record<string, unknown>;
	cwd: string;
	state: Record<string, unknown>;
	lastComponent: Component | undefined;
	expanded: boolean;
	isError: boolean;
	isPartial: boolean;
	invalidate: () => void;
	toolCallId?: string;
};

type BuiltInSet = {
	bash: ReturnType<typeof createBashToolDefinition>;
	grep: ReturnType<typeof createGrepToolDefinition>;
	find: ReturnType<typeof createFindToolDefinition>;
	ls: ReturnType<typeof createLsToolDefinition>;
	read: ReturnType<typeof createReadToolDefinition>;
};

const NATIVE_CALL_SLOT = "__craftNativeCall";
const NATIVE_RESULT_SLOT = "__craftNativeResult";
const EMPTY_SLOT = "__craftEmpty";
const GROUP_CALL_SLOT = "__craftGroupCall";
const GROUP_TOKEN_SLOT = "__craftGroupToken";

const builtInCache = new Map<string, BuiltInSet>();

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function loadBashToolOptions(): { shellPath?: string; commandPrefix?: string } {
	const settingsPath = join(getAgentDir(), "settings.json");
	if (!existsSync(settingsPath)) return {};
	try {
		const raw = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
		return {
			shellPath: readString(raw.shellPath),
			commandPrefix: readString(raw.shellCommandPrefix),
		};
	} catch {
		return {};
	}
}

function builtIns(cwd: string): BuiltInSet {
	let tools = builtInCache.get(cwd);
	if (!tools) {
		tools = {
			bash: createBashToolDefinition(cwd, loadBashToolOptions()),
			grep: createGrepToolDefinition(cwd),
			find: createFindToolDefinition(cwd),
			ls: createLsToolDefinition(cwd),
			read: createReadToolDefinition(cwd),
		};
		builtInCache.set(cwd, tools);
	}
	return tools;
}

function slotComponent(context: RenderContext, slot: string): Component | undefined {
	const value = context.state[slot];
	return value && typeof value === "object" ? (value as Component) : undefined;
}

function nativeContext(context: RenderContext, slot: string): RenderContext {
	return { ...context, lastComponent: slotComponent(context, slot) };
}

function rememberNative(context: RenderContext, slot: string, component: Component): Component {
	context.state[slot] = component;
	return component;
}

function collapsedText(last: Component | undefined): Text {
	return last instanceof Text ? last : new Text("", 0, 0);
}

function expandHint(): string {
	return keyHint("app.tools.expand", "to expand");
}

function paintCollapsed(
	text: string,
	theme: Theme,
	take: PreviewTake,
	error: boolean,
	last: Component | undefined,
): Text {
	const preview = collapsePreviewLines(text, take);
	const tone: PreviewTone = error ? "error" : "toolOutput";
	const view = collapsedText(last);
	view.setText(formatCollapsedPreview(preview, theme, tone, expandHint()));
	return view;
}

function withLiveExecute(def: AnyToolDefinition, name: BuiltinName): AnyToolDefinition {
	return {
		...def,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return builtIns(ctx.cwd)[name].execute(toolCallId, params as never, signal, onUpdate as never, ctx);
		},
	};
}

function registerPreviewTool(pi: ExtensionAPI, name: PreviewToolName, cwd: string): void {
	const take: PreviewTake = name === "bash" ? "tail" : "head";
	pi.registerTool({
		...withLiveExecute(builtIns(cwd)[name], name),
		renderResult(result, options, theme, context) {
			if (!options.expanded) {
				return paintCollapsed(resultText(result), theme, take, context.isError, context.lastComponent);
			}
			const ctx = context as RenderContext;
			const original = builtIns(ctx.cwd)[name];
			const native = nativeContext(ctx, NATIVE_RESULT_SLOT);
			const component = original.renderResult!(result as never, options, theme, native as never);
			return rememberNative(ctx, NATIVE_RESULT_SLOT, component);
		},
	} as AnyToolDefinition);
}

type BranchReader = () => readonly BranchEntry[];

function emptySlot(context: RenderContext): Component {
	const existing = slotComponent(context, EMPTY_SLOT);
	if (existing instanceof Container) return existing;
	return rememberNative(context, EMPTY_SLOT, new Container());
}

function groupedCall(paths: readonly string[], theme: Theme, context: RenderContext): Component {
	const existing = slotComponent(context, GROUP_CALL_SLOT);
	const view = existing instanceof Text ? existing : new Text("", 0, 0);
	view.setText(formatGroupedReadCall(paths, theme));
	return rememberNative(context, GROUP_CALL_SLOT, view);
}

function liveRead(context: RenderContext, hasImage: boolean): LiveRead {
	return {
		id: context.toolCallId ?? "",
		expanded: context.expanded,
		isPartial: context.isPartial,
		isError: context.isError,
		hasImage,
	};
}

const settledReads = new Map<string, ReadResultFact>();
const liveCalls = new Map<string, ReadCallRef>();

function noteCall(id: string | undefined, path: string): void {
	if (!id) return;
	liveCalls.set(id, { id, path, read: path.length > 0 });
}

function noteSettled(id: string | undefined, fact: ReadResultFact | undefined): void {
	if (!id) return;
	if (!fact) settledReads.delete(id);
	else settledReads.set(id, fact);
}

function resultsFor(entries: readonly BranchEntry[]): Map<string, ReadResultFact> {
	const results = new Map(collectReadResults(entries));
	for (const [id, fact] of settledReads) {
		if (!results.has(id)) results.set(id, fact);
	}
	return results;
}

function assignCurrentRead(
	getBranch: BranchReader,
	context: RenderContext,
	args: unknown,
	hasImage: boolean,
): ReadAssignment {
	const live = liveRead(context, hasImage);
	const path = readArgPath(args);
	noteCall(live.id, path);
	if (live.isPartial) noteSettled(live.id, undefined);
	else if (live.id) noteSettled(live.id, { isError: live.isError, hasImage: live.hasImage });
	if (!live.id) {
		return { role: "standalone", leaderId: "", ids: [], paths: path ? [path] : [] };
	}
	const entries = safeBranch(getBranch);
	return assignReadRole(readCallsAround(entries, live.id, [...liveCalls.values()]), resultsFor(entries), live);
}

function registerReadTool(pi: ExtensionAPI, cwd: string, getBranch: BranchReader, invalidators: Map<string, () => void>): void {
	pi.registerTool({
		...withLiveExecute(builtIns(cwd).read, READ_TOOL_NAME),
		renderShell: "self",
		renderCall(args, theme, context) {
			const ctx = context as RenderContext;
			const original = builtIns(ctx.cwd).read;
			const native = rememberNative(
				ctx,
				NATIVE_CALL_SLOT,
				original.renderCall!(args as never, theme, nativeContext(ctx, NATIVE_CALL_SLOT) as never),
			);
			if (ctx.toolCallId) invalidators.set(ctx.toolCallId, ctx.invalidate);
			const hasImage = collectReadResults(safeBranch(getBranch)).get(ctx.toolCallId ?? "")?.hasImage ?? false;
			const assignment = assignCurrentRead(getBranch, ctx, args, hasImage);
			notifyGroup(ctx, assignment, invalidators);
			if (assignment.role === "follower") return emptySlot(ctx);
			if (assignment.role === "leader") return groupedCall(assignment.paths, theme, ctx);
			if (!usesReadShellBox(ctx)) return native;
			return paintShellCall(native, theme, ctx);
		},
		renderResult(result, options, theme, context) {
			const ctx = context as RenderContext;
			const original = builtIns(ctx.cwd).read;
			const native = rememberNative(
				ctx,
				NATIVE_RESULT_SLOT,
				original.renderResult!(result as never, options, theme, nativeContext(ctx, NATIVE_RESULT_SLOT) as never),
			);
			if (ctx.toolCallId) invalidators.set(ctx.toolCallId, ctx.invalidate);
			const assignment = assignCurrentRead(getBranch, ctx, ctx.args, contentHasImage(result?.content));
			notifyGroup(ctx, assignment, invalidators);
			if (assignment.role === "follower") return emptySlot(ctx);
			if (!usesReadShellBox({ expanded: options.expanded, isError: ctx.isError })) return native;
			return paintShellResult(native, theme, ctx);
		},
	} as AnyToolDefinition);
}

function safeBranch(getBranch: BranchReader): readonly BranchEntry[] {
	try {
		return getBranch();
	} catch {
		return [];
	}
}

function notifyGroup(
	context: RenderContext,
	assignment: ReadAssignment,
	invalidators: Map<string, () => void>,
): void {
	const self = context.toolCallId ?? "";
	const token = `${assignment.role}:${assignment.leaderId}:${assignment.ids.join(",")}`;
	if (context.state[GROUP_TOKEN_SLOT] === token) return;
	context.state[GROUP_TOKEN_SLOT] = token;
	if (assignment.role === "standalone" || assignment.ids.length < 2) return;
	const targets = assignment.role === "leader" ? assignment.ids : [assignment.leaderId];
	for (const id of targets) {
		if (!id || id === self) continue;
		invalidators.get(id)?.();
	}
}

export function installToolPreview(pi: ExtensionAPI): void {
	const installed = new Set<BuiltinName>();
	const invalidators = new Map<string, () => void>();
	let getBranch: BranchReader = () => [];

	const install = (cwd: string): void => {
		for (const name of listOverridableTools(pi, PREVIEW_TOOL_NAMES)) {
			if (installed.has(name)) continue;
			registerPreviewTool(pi, name, cwd);
			installed.add(name);
		}
		if (
			!installed.has(READ_TOOL_NAME) &&
			listOverridableTools(pi, [READ_TOOL_NAME]).includes(READ_TOOL_NAME)
		) {
			registerReadTool(pi, cwd, () => getBranch(), invalidators);
			installed.add(READ_TOOL_NAME);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		getBranch = () => ctx.sessionManager.getBranch() as readonly BranchEntry[];
		install(ctx.cwd);
	});

	pi.on("session_shutdown", () => {
		getBranch = () => [];
		invalidators.clear();
		settledReads.clear();
		liveCalls.clear();
	});
}
