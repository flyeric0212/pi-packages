export const SKILL_PREFIX = "skill:";

/** Built-in interactive commands plus this package's own slash commands. */
export const RESERVED_COMMAND_NAMES: ReadonlySet<string> = new Set([
	"settings",
	"model",
	"scoped-models",
	"export",
	"import",
	"share",
	"copy",
	"name",
	"session",
	"changelog",
	"hotkeys",
	"fork",
	"clone",
	"tree",
	"trust",
	"login",
	"logout",
	"new",
	"compact",
	"resume",
	"reload",
	"quit",
	"llama",
	"clear",
	"cls",
]);

export type CommandRecord = {
	name: string;
	source: "extension" | "prompt" | "skill";
	description?: string;
};

export type SkillCatalog = {
	skills: ReadonlyMap<string, { description?: string }>;
	blocked: ReadonlySet<string>;
	/** Slash names without the leading `/` that the editor may highlight. */
	invocable: ReadonlySet<string>;
};

export function skillShortName(commandName: string): string | undefined {
	if (!commandName.startsWith(SKILL_PREFIX)) return undefined;
	const name = commandName.slice(SKILL_PREFIX.length);
	return name.length > 0 ? name : undefined;
}

export function buildSkillCatalog(commands: readonly CommandRecord[]): SkillCatalog {
	const blocked = new Set(RESERVED_COMMAND_NAMES);
	const skills = new Map<string, { description?: string }>();
	const invocable = new Set(RESERVED_COMMAND_NAMES);

	for (const command of commands) {
		invocable.add(command.name);
		if (command.source === "skill") {
			const name = skillShortName(command.name);
			if (name) skills.set(name, { description: command.description });
			continue;
		}
		blocked.add(command.name);
	}

	for (const name of skills.keys()) {
		if (!blocked.has(name)) invocable.add(name);
	}

	return { skills, blocked, invocable };
}

export function isInvocableSlashName(name: string, catalog: SkillCatalog): boolean {
	return catalog.invocable.has(name);
}

export function canUseShortName(name: string, catalog: SkillCatalog): boolean {
	return catalog.skills.has(name) && !catalog.blocked.has(name);
}
