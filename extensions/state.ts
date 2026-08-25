import { displayedTps, type TokenSpeedSnapshot } from "./token-speed.ts";

export type CraftState = {
	modelName?: string;
	modelId?: string;
	thinking?: string;
	cwd: string;
	version: string;
	tps: TokenSpeedSnapshot;
};

const idleTps: TokenSpeedSnapshot = { tps: null, streaming: false };

export function createState(init?: Partial<CraftState>): CraftState {
	return {
		cwd: init?.cwd ?? "",
		version: init?.version ?? "",
		tps: init?.tps ?? idleTps,
		modelName: init?.modelName,
		modelId: init?.modelId,
		thinking: init?.thinking,
	};
}

export class CraftStore {
	private value: CraftState;
	private listeners = new Set<() => void>();

	constructor(init?: Partial<CraftState>) {
		this.value = createState(init);
	}

	get snapshot(): CraftState {
		return this.value;
	}

	patch(partial: Partial<CraftState>): boolean {
		const next = { ...this.value, ...partial };
		if (sameCraftState(this.value, next)) {
			this.value = next;
			return false;
		}
		this.value = next;
		for (const listener of this.listeners) listener();
		return true;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	reset(init?: Partial<CraftState>): void {
		this.value = createState(init);
		this.listeners.clear();
	}
}

export function sameCraftState(a: CraftState, b: CraftState): boolean {
	return (
		a.modelName === b.modelName &&
		a.modelId === b.modelId &&
		a.thinking === b.thinking &&
		a.cwd === b.cwd &&
		a.version === b.version &&
		a.tps.streaming === b.tps.streaming &&
		displayedTps(a.tps.tps) === displayedTps(b.tps.tps)
	);
}
