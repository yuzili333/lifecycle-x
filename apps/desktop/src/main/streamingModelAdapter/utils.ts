import { randomUUID } from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function mergeAbortSignals(signals: Array<AbortSignal | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) {
    return undefined;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export function parseJsonSafely(value: string) {
  try {
    return { success: true as const, value: JSON.parse(value) as unknown };
  } catch (error) {
    return { success: false as const, error };
  }
}

export async function withTimeout<T>(timeoutMs: number | undefined, signal: AbortSignal | undefined, operation: (signal?: AbortSignal) => Promise<T>) {
  if (!timeoutMs || timeoutMs <= 0) {
    return operation(signal);
  }
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const mergedSignal = mergeAbortSignals([signal, timeoutController.signal]);
  try {
    return await operation(mergedSignal);
  } finally {
    clearTimeout(timer);
  }
}
