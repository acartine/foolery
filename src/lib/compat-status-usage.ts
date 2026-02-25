interface CounterMap {
  [context: string]: number;
}

export interface CompatStatusUsageSnapshot {
  serialized: number;
  consumed: number;
  serializedByContext: CounterMap;
  consumedByContext: CounterMap;
}

const usage = {
  serialized: 0,
  consumed: 0,
  serializedByContext: {} as CounterMap,
  consumedByContext: {} as CounterMap,
};

function bumpCounter(counter: CounterMap, context: string): void {
  const key = context.trim() || "unknown";
  counter[key] = (counter[key] ?? 0) + 1;
}

export function recordCompatStatusSerialized(context: string): void {
  usage.serialized += 1;
  bumpCounter(usage.serializedByContext, context);
}

export function recordCompatStatusConsumed(context: string): void {
  usage.consumed += 1;
  bumpCounter(usage.consumedByContext, context);
}

export function getCompatStatusUsageSnapshot(): CompatStatusUsageSnapshot {
  return {
    serialized: usage.serialized,
    consumed: usage.consumed,
    serializedByContext: { ...usage.serializedByContext },
    consumedByContext: { ...usage.consumedByContext },
  };
}

export function resetCompatStatusUsageForTests(): void {
  usage.serialized = 0;
  usage.consumed = 0;
  usage.serializedByContext = {};
  usage.consumedByContext = {};
}
