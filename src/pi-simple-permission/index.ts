import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PERMISSION_CONFIG, loadConfig, type PermissionConfig } from "./config.ts";
import { evaluatePermission } from "./engine.ts";

export default function piSimplePermissionExtension(pi: ExtensionAPI): void {
	let config: PermissionConfig = DEFAULT_PERMISSION_CONFIG;

	pi.on("session_start", (_event, ctx) => {
		config = loadConfig({
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
			onDiagnostic(message) {
				if (ctx.hasUI) ctx.ui.notify(message, "warning");
				else console.error(`[pi-simple-permission] ${message}`);
			},
		});
	});

	pi.on("tool_call", async (event, ctx: ExtensionContext): Promise<ToolCallEventResult | void> => {
		const decision = evaluatePermission(event.toolName, event.input, config, ctx.cwd);
		if (decision.action === "allow") return;

		if (decision.action === "deny") {
			const reason = decision.reason ?? `Tool '${event.toolName}' is blocked by the permission policy.`;
			if (ctx.hasUI) ctx.ui.notify(reason, "error");
			return { block: true, reason };
		}

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Tool '${event.toolName}' requires confirmation, but no interactive UI is available.`,
			};
		}

		const confirmed = await ctx.ui.confirm(
			`Permission Check: ${event.toolName}`,
			decision.reason ?? `Allow '${event.toolName}'?`,
		);
		if (!confirmed) {
			return { block: true, reason: `User denied permission to execute '${event.toolName}'.` };
		}
	});
}
