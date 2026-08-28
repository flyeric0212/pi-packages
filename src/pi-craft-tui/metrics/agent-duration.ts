import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultNow, type NowFn } from "../utils.ts";

export type AgentDurationSnapshot = {
	/** Most recently settled logical agent run. */
	readonly lastMs: number | null;
	/** Sum of settled logical agent runs in this extension runtime. */
	readonly totalMs: number;
	/** Number of settled Agent execution cycles included in totalMs. */
	readonly cycles: number;
};

const EMPTY_SNAPSHOT: AgentDurationSnapshot = { lastMs: null, totalMs: 0, cycles: 0 };

/**
 * Measures one user-visible agent cycle from the first `agent_start` through
 * `agent_settled`. Additional low-level starts before settlement are retries,
 * compaction retries, or queued continuations, so they must not reset the
 * original baseline.
 */
export class AgentDurationEngine {
	private readonly now: NowFn;
	private startedAt: number | null = null;
	private value: AgentDurationSnapshot = EMPTY_SNAPSHOT;

	constructor(options?: { now?: NowFn }) {
		this.now = options?.now ?? defaultNow;
	}

	start(): boolean {
		if (this.startedAt != null) return false;
		this.startedAt = this.now();
		return true;
	}

	settle(): number | null {
		if (this.startedAt == null) return null;
		const finishedAt = this.now();
		const elapsed = finishedAt - this.startedAt;
		this.startedAt = null;
		if (!Number.isFinite(elapsed) || elapsed < 0) return null;
		this.value = {
			lastMs: elapsed,
			totalMs: this.value.totalMs + elapsed,
			cycles: this.value.cycles + 1,
		};
		return elapsed;
	}

	snapshot(): AgentDurationSnapshot {
		return this.value;
	}

	reset(): void {
		this.startedAt = null;
		this.value = EMPTY_SNAPSHOT;
	}
}

/** Wire the public Agent lifecycle to the runtime metric consumed by `/stats`. */
export function installAgentDuration(pi: ExtensionAPI, engine: AgentDurationEngine): void {
	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode === "tui") engine.start();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		engine.settle();
	});

	pi.on("session_shutdown", () => {
		engine.reset();
	});
}


