import { validateVisualizationSpec, type VisualizationValidationOptions } from "./validator";
import type {
  StreamingVisualizationState,
  VisualizationDeltaEvent,
  VisualizationErrorEvent,
  VisualizationRenderError,
  VisualizationSpec,
  VisualizationStartEvent,
  VisualizationStreamEvent,
} from "./types";

type AssemblerEntry = {
  state: StreamingVisualizationState;
  deltas: Map<number, VisualizationDeltaEvent>;
  appliedSequences: Set<number>;
  rawBuffer: string;
};

export class StreamVisualizationAssembler {
  private readonly entries = new Map<string, AssemblerEntry>();

  constructor(private readonly validationOptions: VisualizationValidationOptions = {}) {}

  handleStreamEvent(event: VisualizationStreamEvent): StreamingVisualizationState {
    if (event.type === "visualization_start") {
      return this.start(event);
    }
    if (event.type === "visualization_delta") {
      return this.delta(event);
    }
    if (event.type === "visualization_complete") {
      return this.complete(event.visualizationId, event.payload.spec);
    }
    return this.fail(event);
  }

  getStreamingState(visualizationId: string) {
    return this.entries.get(visualizationId)?.state;
  }

  dispose(visualizationId: string) {
    this.entries.delete(visualizationId);
  }

  flushIncomplete() {
    const states: StreamingVisualizationState[] = [];
    for (const [visualizationId, entry] of this.entries.entries()) {
      if (entry.state.status !== "ready" && entry.state.status !== "completed" && entry.state.status !== "failed") {
        entry.state = failedState(visualizationId, {
          code: "VISUALIZATION_STREAM_INCOMPLETE",
          message: "可视化流未完整结束。",
          visualizationId,
          recoverable: true,
        });
        states.push(entry.state);
      }
    }
    return states;
  }

  private start(event: VisualizationStartEvent) {
    const entry: AssemblerEntry = {
      state: {
        visualizationId: event.visualizationId,
        status: "receiving",
        partialSpec: {
          specVersion: event.payload.specVersion === "1.0" ? "1.0" : undefined,
          type: event.payload.type,
          title: event.payload.title,
          visualizationId: event.visualizationId,
        },
        updatedAt: event.createdAt,
      },
      deltas: new Map(),
      appliedSequences: new Set(),
      rawBuffer: "",
    };
    this.entries.set(event.visualizationId, entry);
    return entry.state;
  }

  private delta(event: VisualizationDeltaEvent) {
    const entry = this.ensureEntry(event.visualizationId, event.createdAt);
    const sequence = event.payload.sequence;
    if (entry.appliedSequences.has(sequence) || entry.deltas.has(sequence)) {
      return entry.state;
    }
    entry.deltas.set(sequence, event);
    this.applyPendingDeltas(entry);
    entry.state = { ...entry.state, status: "receiving", updatedAt: event.createdAt };
    return entry.state;
  }

  private complete(visualizationId: string, spec: VisualizationSpec) {
    const entry = this.ensureEntry(visualizationId, new Date().toISOString());
    entry.state = { ...entry.state, status: "validating", updatedAt: new Date().toISOString() };
    const result = validateVisualizationSpec(spec, this.validationOptions);
    if (!result.success) {
      entry.state = failedState(visualizationId, result.error);
      return entry.state;
    }
    entry.state = {
      visualizationId,
      status: "ready",
      partialSpec: result.spec,
      spec: result.spec,
      updatedAt: new Date().toISOString(),
    };
    return entry.state;
  }

  private fail(event: VisualizationErrorEvent) {
    const visualizationId = event.visualizationId ?? "unknown";
    const entry = this.ensureEntry(visualizationId, event.createdAt);
    entry.state = failedState(visualizationId, {
      code: "UNKNOWN_ERROR",
      message: event.payload.message,
      recoverable: event.payload.recoverable,
      visualizationId,
      details: [event.payload.code],
    });
    return entry.state;
  }

  private ensureEntry(visualizationId: string, createdAt: string) {
    const existing = this.entries.get(visualizationId);
    if (existing) {
      return existing;
    }
    const entry: AssemblerEntry = {
      state: { visualizationId, status: "receiving", updatedAt: createdAt },
      deltas: new Map(),
      appliedSequences: new Set(),
      rawBuffer: "",
    };
    this.entries.set(visualizationId, entry);
    return entry;
  }

  private applyPendingDeltas(entry: AssemblerEntry) {
    const sequences = Array.from(entry.deltas.keys()).sort((a, b) => a - b);
    for (const sequence of sequences) {
      const event = entry.deltas.get(sequence);
      if (!event || entry.appliedSequences.has(sequence)) {
        continue;
      }
      entry.deltas.delete(sequence);
      entry.appliedSequences.add(sequence);
      if (event.payload.rawDelta) {
        entry.rawBuffer = `${entry.rawBuffer}${event.payload.rawDelta}`;
        entry.state.partialSpec = parsePartialSpec(entry.rawBuffer) ?? entry.state.partialSpec;
      }
      if (event.payload.path) {
        entry.state.partialSpec = applyPathValue(entry.state.partialSpec ?? {}, event.payload.path, event.payload.value);
      }
    }
  }
}

function parsePartialSpec(raw: string): Partial<VisualizationSpec> | undefined {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed as Partial<VisualizationSpec> : undefined;
  } catch {
    return undefined;
  }
}

function applyPathValue(spec: Partial<VisualizationSpec>, path: string, value: unknown): Partial<VisualizationSpec> {
  const next: Record<string, unknown> = { ...spec };
  const parts = path.split(".").filter(Boolean);
  let target = next;
  for (const part of parts.slice(0, -1)) {
    const existing = target[part];
    target[part] = typeof existing === "object" && existing !== null && !Array.isArray(existing) ? { ...existing } : {};
    target = target[part] as Record<string, unknown>;
  }
  const last = parts.at(-1);
  if (last) {
    target[last] = value;
  }
  return next as Partial<VisualizationSpec>;
}

function failedState(visualizationId: string, error: VisualizationRenderError): StreamingVisualizationState {
  return {
    visualizationId,
    status: "failed",
    error,
    updatedAt: new Date().toISOString(),
  };
}
