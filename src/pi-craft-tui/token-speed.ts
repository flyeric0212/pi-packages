import {
	TPS_DISPLAY_HYSTERESIS,
	TPS_DISPLAY_INTERVAL_MS,
	TPS_DISPLAY_MIN_MS,
	TPS_MAX_PLAUSIBLE,
	TPS_MIN_ACTIVE_MS,
} from "./config.ts";
import { defaultNow, type NowFn } from "./utils.ts";

export type TokenSpeedSnapshot = {
	tps: number | null;
	streaming: boolean;
};

export type OutputUsage = {
	output?: number;
	reasoning?: number;
};

function outputTokens(usage: OutputUsage | undefined): number {
	const output = usage?.output;
	if (output == null || !Number.isFinite(output) || output <= 0) return 0;
	return output;
}

export function displayedTps(tps: number | null): number | null {
	if (tps == null || !Number.isFinite(tps)) return null;
	return Math.round(tps);
}

/**
 * Wall-clock delivery rate of one assistant message.
 *
 * tok/s = provider usage.output / seconds from message_start to message_end.
 * TTFT, hidden reasoning, buffering, and stalls stay in the denominator; tool
 * waits between messages do not. There is no character estimate and no stall
 * subtraction — without provider output the Footer keeps the last integer, so
 * the slot stays calm while the next message has not produced measurable
 * output yet.
 *
 * Live display waits until one second has elapsed and usage.output is known,
 * then publishes at most every TPS_DISPLAY_INTERVAL_MS, ignoring integer
 * moves smaller than TPS_DISPLAY_HYSTERESIS. finish() publishes the measured
 * value immediately.
 */
export class TokenSpeedEngine {
	private streaming = false;
	private finished = false;
	private usage: OutputUsage | undefined;
	private startedAt: number | undefined;
	private endedAt: number | undefined;
	private generation = 0;
	private published: TokenSpeedSnapshot | null = null;
	private publishedGeneration = -1;
	private publishedAt = 0;
	private readonly now: NowFn;

	constructor(now: NowFn = defaultNow) {
		this.now = now;
	}

	snapshot(): TokenSpeedSnapshot {
		const current = this.measure();
		if (this.finished) {
			if (current.tps != null) this.publish(current);
			return this.view();
		}
		const ready = current.tps != null && this.elapsedMs() >= TPS_DISPLAY_MIN_MS;
		if (!ready) return this.view();
		if (this.publishedGeneration === this.generation && this.holdLive(current.tps)) {
			return this.view();
		}
		this.publish(current);
		return this.view();
	}

	start(): void {
		this.generation += 1;
		this.streaming = true;
		this.finished = false;
		this.usage = undefined;
		this.startedAt = this.now();
		this.endedAt = undefined;
	}

	note(usage?: OutputUsage): void {
		if (!this.streaming || outputTokens(usage) <= 0) return;
		this.usage = usage;
	}

	finish(usage?: OutputUsage): void {
		this.streaming = false;
		this.finished = true;
		this.endedAt = this.now();
		if (usage) this.usage = usage;
		const current = this.measure();
		if (current.tps != null) this.publish(current);
	}

	reset(): void {
		this.generation += 1;
		this.streaming = false;
		this.finished = false;
		this.usage = undefined;
		this.startedAt = undefined;
		this.endedAt = undefined;
		this.published = null;
		this.publishedGeneration = -1;
		this.publishedAt = 0;
	}

	private holdLive(tps: number | null): boolean {
		if (this.now() - this.publishedAt < TPS_DISPLAY_INTERVAL_MS) return true;
		const next = displayedTps(tps);
		const prev = displayedTps(this.published?.tps ?? null);
		if (next == null || prev == null) return false;
		if (next === prev) return true;
		return Math.abs(next - prev) < TPS_DISPLAY_HYSTERESIS;
	}

	private publish(snap: TokenSpeedSnapshot): void {
		this.published = { tps: snap.tps, streaming: this.streaming };
		this.publishedGeneration = this.generation;
		this.publishedAt = this.now();
	}

	private view(): TokenSpeedSnapshot {
		if (!this.published) return { tps: null, streaming: this.streaming };
		return { ...this.published, streaming: this.streaming };
	}

	private measure(): TokenSpeedSnapshot {
		const streaming = this.streaming;
		const tokens = outputTokens(this.usage);
		const elapsedMs = this.elapsedMs();
		if (tokens <= 0 || elapsedMs < TPS_MIN_ACTIVE_MS) {
			return { tps: null, streaming };
		}
		const tps = tokens / (elapsedMs / 1000);
		if (!Number.isFinite(tps) || tps <= 0 || tps > TPS_MAX_PLAUSIBLE) {
			return { tps: null, streaming };
		}
		return { tps, streaming };
	}

	private elapsedMs(): number {
		if (this.startedAt == null) return 0;
		const end = this.finished ? (this.endedAt ?? this.now()) : this.now();
		return Math.max(0, end - this.startedAt);
	}
}
