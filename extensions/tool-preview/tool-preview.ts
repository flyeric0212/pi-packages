import { CONFIG_DIR_NAME, createBashToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, getAgentDir, keyHint, type ExtensionAPI, type ToolInfo, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Text, type Component } from "@earendil-works/pi-tui";
import { collapsePreviewLines, formatCollapsedPreview, resultText, type PreviewTake, type PreviewTone } from "./preview.ts";

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

const NATIVE_RESULT_SLOT = "__craftNativeResult";

const builtInCache = new Map<string, BuiltInSet>();

export type ToolRuntimeSettings = {
	shellPath?: string;
	commandPrefix?: string;
	autoResizeImages: boolean;
};

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

/** Same leading-`~` rules as Pi's `normalizePath` (`~`, `~/`, Windows `~\`). */
export function expandLeadingTilde(path: string, home: string = homedir()): string {
	if (path === "~") return home;
	if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) {
		return join(home, path.slice(2));
	}
	return path;
}

function imageAutoResize(raw: Record<string, unknown>): boolean | undefined {
	const images = raw.images;
	if (typeof images !== "object" || images === null || Array.isArray(images)) return undefined;
	return readBoolean((images as Record<string, unknown>).autoResize);
}

/** Project settings win. `autoResizeImages` defaults to true, matching Pi. */
export function resolveToolSettings(
	globalRaw: Record<string, unknown>,
	projectRaw: Record<string, unknown> = {},
	home: string = homedir(),
): ToolRuntimeSettings {
	const shellPath = readString(projectRaw.shellPath) ?? readString(globalRaw.shellPath);
	const commandPrefix = readString(projectRaw.shellCommandPrefix) ?? readString(globalRaw.shellCommandPrefix);
	return {
		shellPath: shellPath ? expandLeadingTilde(shellPath, home) : undefined,
		commandPrefix,
		autoResizeImages: imageAutoResize(projectRaw) ?? imageAutoResize(globalRaw) ?? true,
	};
}

function readJsonObject(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>;
		return {};
	} catch {
		return {};
	}
}

function loadToolSettings(cwd: string): ToolRuntimeSettings {
	return resolveToolSettings(
		readJsonObject(join(getAgentDir(), "settings.json")),
		readJsonObject(join(cwd, CONFIG_DIR_NAME, "settings.json")),
	);
}

function builtIns(cwd: string): BuiltInSet {
	let tools = builtInCache.get(cwd);
	if (!tools) {
		const settings = loadToolSettings(cwd);
		tools = {
			bash: createBashToolDefinition(cwd, {
				shellPath: settings.shellPath,
				commandPrefix: settings.commandPrefix,
			}),
			grep: createGrepToolDefinition(cwd),
			find: createFindToolDefinition(cwd),
			ls: createLsToolDefinition(cwd),
			read: createReadToolDefinition(cwd, { autoResizeImages: settings.autoResizeImages }),
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

function registerReadTool(pi: ExtensionAPI, cwd: string): void {
	// Own the outer shell so a collapsed success stays one unboxed call line.
	// Expanded / error use Pi's native call and result renderers.
	pi.registerTool({
		...withLiveExecute(builtIns(cwd).read, READ_TOOL_NAME),
		renderShell: "self",
	} as AnyToolDefinition);
}

export function installToolPreview(pi: ExtensionAPI): void {
	const installed = new Set<BuiltinName>();

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
			registerReadTool(pi, cwd);
			installed.add(READ_TOOL_NAME);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		install(ctx.cwd);
	});
}
