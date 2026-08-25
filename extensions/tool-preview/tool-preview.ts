import { CONFIG_DIR_NAME, createReadToolDefinition, getAgentDir, type ExtensionAPI, type ToolInfo, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const READ_TOOL_NAME = "read";

export function toolOwnerSource(tools: readonly ToolInfo[], name: string): string | undefined {
	return tools.find((tool) => tool.name === name)?.sourceInfo.source;
}

export function shouldOverrideBuiltinPreview(tools: readonly ToolInfo[], name: string): boolean {
	return toolOwnerSource(tools, name) === "builtin";
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

export type ReadToolSettings = {
	autoResizeImages: boolean;
};

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
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
): ReadToolSettings {
	return {
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

function loadToolSettings(cwd: string): ReadToolSettings {
	return resolveToolSettings(
		readJsonObject(join(getAgentDir(), "settings.json")),
		readJsonObject(join(cwd, CONFIG_DIR_NAME, "settings.json")),
	);
}

const readDefinitionCache = new Map<string, ReturnType<typeof createReadToolDefinition>>();

function builtinRead(cwd: string): ReturnType<typeof createReadToolDefinition> {
	let definition = readDefinitionCache.get(cwd);
	if (!definition) {
		const settings = loadToolSettings(cwd);
		definition = createReadToolDefinition(cwd, { autoResizeImages: settings.autoResizeImages });
		readDefinitionCache.set(cwd, definition);
	}
	return definition;
}

/** Execute through the built-in bound to the live session cwd. */
function withLiveExecute(def: AnyToolDefinition): AnyToolDefinition {
	return {
		...def,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return builtinRead(ctx.cwd).execute(toolCallId, params as never, signal, onUpdate as never, ctx);
		},
	};
}

function registerReadTool(pi: ExtensionAPI, cwd: string): void {
	// Own the outer shell so a collapsed success stays one unboxed call line.
	// Expanded / error use Pi's native call and result renderers.
	pi.registerTool({
		...withLiveExecute(builtinRead(cwd)),
		renderShell: "self",
	} as AnyToolDefinition);
}

export function installToolPreview(pi: ExtensionAPI): void {
	let installed = false;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || installed) return;
		if (!listOverridableTools(pi, [READ_TOOL_NAME]).includes(READ_TOOL_NAME)) return;
		registerReadTool(pi, ctx.cwd);
		installed = true;
	});
}