import { canUseShortName, SKILL_PREFIX, skillShortName, buildSkillCatalog, type SkillCatalog } from "../catalog.ts";
import { type AutocompleteItem } from "@earendil-works/pi-tui";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LEADING_COMMAND = /^(\s*)\/(\S+)([\s\S]*)$/;

/**
 * Rewrite a leading `/name` into Pi's native `/skill:name` when `name` is a
 * loaded skill that does not collide with a reserved or already-taken command.
 * `/skill:…` and non-leading slashes are left alone.
 */
export function rewriteLeadingSkillCommand(text: string, catalog: SkillCatalog): string | undefined {
	const match = LEADING_COMMAND.exec(text);
	if (!match) return undefined;

	const indent = match[1] ?? "";
	const name = match[2] ?? "";
	if (name.includes(":")) return undefined;
	if (!canUseShortName(name, catalog)) return undefined;

	const args = (match[3] ?? "").trimStart();
	return args.length > 0 ? `${indent}/skill:${name} ${args}` : `${indent}/skill:${name}`;
}

function isSlashCommandPrefix(prefix: string): boolean {
	if (!prefix.startsWith("/")) return false;
	if (prefix.includes(" ")) return false;
	return !prefix.slice(1).includes("/");
}

/** Show loaded skills as `/code-review` in the menu; keep `/skill:` if the user already typed it. */
export function shortenSkillSuggestions(
	items: readonly AutocompleteItem[],
	prefix: string,
	catalog: SkillCatalog,
): AutocompleteItem[] {
	if (!isSlashCommandPrefix(prefix)) return [...items];
	if (prefix.slice(1).startsWith(SKILL_PREFIX)) return [...items];

	const used = new Set(items.map((item) => item.value));
	return items.map((item) => {
		const short = skillShortName(item.value);
		if (!short || !canUseShortName(short, catalog)) return item;
		if (used.has(short)) return item;
		used.delete(item.value);
		used.add(short);
		return { ...item, value: short, label: short };
	});
}

export function installSkillShortcuts(pi: ExtensionAPI): void {
	pi.on("input", (event) => {
		if (event.source === "extension") return;
		const next = rewriteLeadingSkillCommand(event.text, buildSkillCatalog(pi.getCommands()));
		if (next === undefined) return;
		return { action: "transform" as const, text: next, images: event.images };
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.addAutocompleteProvider((current) => ({
			triggerCharacters: current.triggerCharacters,
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const result = await current.getSuggestions(lines, cursorLine, cursorCol, options);
				if (!result) return result;
				return {
					...result,
					items: shortenSkillSuggestions(result.items, result.prefix, buildSkillCatalog(pi.getCommands())),
				};
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		}));
	});
}
