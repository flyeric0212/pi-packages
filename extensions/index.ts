import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installClear } from "./clear/clear.ts";
import { installEditor, prefixUserPrompt } from "./editor/editor.ts";
import { installFooter } from "./footer/footer.ts";
import { installHeader } from "./header/header.ts";
import { installSkillShortcuts } from "./skill-shortcuts/skill-shortcuts.ts";
import { buildSkillCatalog, type SkillCatalog } from "./catalog.ts";
import { CraftStore } from "./state.ts";
import {
	displayedTps,
	TokenSpeedEngine,
	type OutputUsage,
	type TokenSpeedSnapshot,
} from "./token-speed.ts";

function isTui(ctx: ExtensionContext): boolean {
	return ctx.mode === "tui";
}

function assistantUsage(message: { role?: string; usage?: OutputUsage }): OutputUsage | undefined {
	if (message.role !== "assistant" || message.usage == null) return undefined;
	return message.usage;
}

function sameDisplayedTps(a: TokenSpeedSnapshot, b: TokenSpeedSnapshot): boolean {
	return displayedTps(a.tps) === displayedTps(b.tps) && a.streaming === b.streaming;
}

export default function (pi: ExtensionAPI): void {
	const store = new CraftStore({ version: VERSION });
	const tps = new TokenSpeedEngine();
	let installed = false;
	let skillCatalog: SkillCatalog | undefined;

	/**
	 * Commands and skills are static within a session, so build once per
	 * session. Built lazily on first use — after session setup finished,
	 * which also covers skills other extensions contribute at session start.
	 */
	const getSkillCatalog = (): SkillCatalog => skillCatalog ?? (skillCatalog = buildSkillCatalog(pi.getCommands()));

	installClear(pi);
	installSkillShortcuts(pi, getSkillCatalog);

	pi.registerMarkdownTransformer((markdown, { messageType }) => {
		if (messageType !== "user") return markdown;
		return prefixUserPrompt(markdown);
	});

	const syncFrom = (ctx: ExtensionContext): void => {
		store.patch({
			modelName: ctx.model?.name,
			modelId: ctx.model?.id,
			thinking: ctx.thinkingLevel ?? pi.getThinkingLevel(),
			cwd: ctx.cwd,
			version: VERSION,
			tps: tps.snapshot(),
		});
	};

	pi.on("session_start", (event, ctx) => {
		if (!isTui(ctx)) return;
		// Drop any cached catalog (possibly built outside this session); the
		// next use rebuilds it after the session has been fully set up.
		skillCatalog = undefined;
		syncFrom(ctx);
		installHeader(ctx, pi, event.reason === "startup");
		installEditor(ctx, pi, getSkillCatalog);
		installFooter(ctx, store);
		installed = true;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		tps.reset();
		skillCatalog = undefined;
		if (isTui(ctx) && installed) {
			ctx.ui.setHeader(undefined);
			ctx.ui.setEditorComponent(undefined);
			ctx.ui.setFooter(undefined);
		}
		store.reset({ version: VERSION });
		installed = false;
	});

	pi.on("model_select", (_event, ctx) => {
		if (isTui(ctx)) syncFrom(ctx);
	});

	pi.on("thinking_level_select", (_event, ctx) => {
		if (isTui(ctx)) syncFrom(ctx);
	});

	pi.on("message_start", (event, ctx) => {
		if (!isTui(ctx) || event.message.role !== "assistant") return;
		tps.start();
		tps.note(assistantUsage(event.message));
		syncFrom(ctx);
	});

	pi.on("message_update", (event, ctx) => {
		if (!isTui(ctx) || event.message.role !== "assistant") return;
		const delta = event.assistantMessageEvent;
		if (delta.type !== "text_delta" && delta.type !== "thinking_delta" && delta.type !== "toolcall_delta") {
			return;
		}
		tps.note(assistantUsage(event.message));
		const snap = tps.snapshot();
		if (sameDisplayedTps(store.snapshot.tps, snap)) return;
		store.patch({ tps: snap });
	});

	pi.on("message_end", (event, ctx) => {
		if (!isTui(ctx) || event.message.role !== "assistant") return;
		tps.finish(assistantUsage(event.message));
		syncFrom(ctx);
	});
}
