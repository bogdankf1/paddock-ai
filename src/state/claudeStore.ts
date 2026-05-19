import { useSyncExternalStore } from "react";
import {
  onClaudeEvent,
  onClaudeLifecycle,
  type ClaudeEvent,
  type ClaudeLifecycle,
} from "../lib/claude";

const MAX_EVENTS = 500;
const FUEL_TANK_TOKENS = 200_000;
const COMPLETE_HOLD_MS = 4000;

export type StoredEvent = {
  id: number;
  receivedAtMs: number;
  payload: ClaudeEvent;
};

export type AgentState =
  | "IDLE"
  | "PLANNING"
  | "EXECUTING"
  | "COMPLETE"
  | "ERROR";

type Status = "idle" | "running" | "error";

export type TranscriptEntry =
  | { kind: "user"; id: number; ts: number; text: string }
  | {
      kind: "assistant_text";
      id: number;
      ts: number;
      text: string;
      complete: boolean;
    }
  | {
      kind: "tool_use";
      id: number;
      ts: number;
      tool: string;
      input: string;
      complete: boolean;
    }
  | {
      kind: "result";
      id: number;
      ts: number;
      success: boolean;
      totalTokens: number | null;
      totalCostUsd: number | null;
      durationSec: number | null;
      message: string | null;
    };

export type ClaudeStoreState = {
  events: StoredEvent[];
  transcript: TranscriptEntry[];
  status: Status;
  agentState: AgentState;
  startedAtMs: number | null;
  exitCode: number | null;
  lastError: string | null;
  tokensUsed: number;
  tankCapacity: number;
  model: string | null;
  activeTool: string | null;
};

const listeners = new Set<() => void>();
let state: ClaudeStoreState = {
  events: [],
  transcript: [],
  status: "idle",
  agentState: "IDLE",
  startedAtMs: null,
  exitCode: null,
  lastError: null,
  tokensUsed: 0,
  tankCapacity: FUEL_TANK_TOKENS,
  model: null,
  activeTool: null,
};
let nextId = 1;
let nextEntryId = 1;
let completeTimer: ReturnType<typeof setTimeout> | null = null;
// Parser state for streaming content blocks: content_block_index → transcript entry id.
const openBlocks = new Map<number, number>();

function setState(updater: (s: ClaudeStoreState) => ClaudeStoreState) {
  state = updater(state);
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => state;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function extractTokens(payload: ClaudeEvent): number | null {
  const p = asRecord(payload);
  if (!p) return null;
  if (typeof p.total_tokens === "number") return p.total_tokens as number;
  const u = asRecord(p.usage);
  if (u) {
    return (
      Number(u.input_tokens ?? 0) +
      Number(u.output_tokens ?? 0) +
      Number(u.cache_creation_input_tokens ?? 0) +
      Number(u.cache_read_input_tokens ?? 0)
    );
  }
  const msg = asRecord(p.message);
  const mu = msg ? asRecord(msg.usage) : null;
  if (mu) {
    return (
      Number(mu.input_tokens ?? 0) +
      Number(mu.output_tokens ?? 0) +
      Number(mu.cache_creation_input_tokens ?? 0) +
      Number(mu.cache_read_input_tokens ?? 0)
    );
  }
  const ev = asRecord(p.event);
  const eu = ev ? asRecord(ev.usage) : null;
  if (eu) {
    return Number(eu.input_tokens ?? 0) + Number(eu.output_tokens ?? 0);
  }
  return null;
}

function pushTranscript(entry: TranscriptEntry) {
  setState((s) => ({ ...s, transcript: s.transcript.concat(entry) }));
}

function updateEntry(
  id: number,
  updater: (e: TranscriptEntry) => TranscriptEntry,
) {
  setState((s) => ({
    ...s,
    transcript: s.transcript.map((e) => (e.id === id ? updater(e) : e)),
  }));
}

function processStreamEvent(p: Record<string, unknown>) {
  const ev = asRecord(p.event);
  if (!ev) return;
  const evType = ev.type as string | undefined;

  if (evType === "message_start") {
    openBlocks.clear();
    return;
  }

  if (evType === "content_block_start") {
    const idx = ev.index as number | undefined;
    const cb = asRecord(ev.content_block);
    if (idx == null || !cb) return;
    const cbType = cb.type as string | undefined;
    if (cbType === "text") {
      const entryId = nextEntryId++;
      openBlocks.set(idx, entryId);
      pushTranscript({
        kind: "assistant_text",
        id: entryId,
        ts: Date.now(),
        text: "",
        complete: false,
      });
    } else if (cbType === "tool_use") {
      const entryId = nextEntryId++;
      openBlocks.set(idx, entryId);
      pushTranscript({
        kind: "tool_use",
        id: entryId,
        ts: Date.now(),
        tool: (cb.name as string) ?? "unknown",
        input: "",
        complete: false,
      });
    }
    return;
  }

  if (evType === "content_block_delta") {
    const idx = ev.index as number | undefined;
    if (idx == null) return;
    const entryId = openBlocks.get(idx);
    if (entryId == null) return;
    const delta = asRecord(ev.delta);
    if (!delta) return;
    const dType = delta.type as string | undefined;
    if (dType === "text_delta" && typeof delta.text === "string") {
      const chunk = delta.text as string;
      updateEntry(entryId, (e) =>
        e.kind === "assistant_text" ? { ...e, text: e.text + chunk } : e,
      );
    } else if (
      dType === "input_json_delta" &&
      typeof delta.partial_json === "string"
    ) {
      const chunk = delta.partial_json as string;
      updateEntry(entryId, (e) =>
        e.kind === "tool_use" ? { ...e, input: e.input + chunk } : e,
      );
    }
    return;
  }

  if (evType === "content_block_stop") {
    const idx = ev.index as number | undefined;
    if (idx == null) return;
    const entryId = openBlocks.get(idx);
    if (entryId != null) {
      updateEntry(entryId, (e) =>
        "complete" in e ? { ...e, complete: true } : e,
      );
      openBlocks.delete(idx);
    }
  }
}

function processResultEvent(p: Record<string, unknown>) {
  pushTranscript({
    kind: "result",
    id: nextEntryId++,
    ts: Date.now(),
    success: Boolean(p.success ?? (p.is_error ? false : true)),
    totalTokens:
      typeof p.total_tokens === "number" ? (p.total_tokens as number) : null,
    totalCostUsd:
      typeof p.total_cost_usd === "number"
        ? (p.total_cost_usd as number)
        : null,
    durationSec:
      typeof p.duration_seconds === "number"
        ? (p.duration_seconds as number)
        : null,
    message:
      typeof p.message === "string"
        ? (p.message as string)
        : typeof p.result === "string"
          ? (p.result as string)
          : null,
  });
}

function deriveLightTransitions(
  prev: ClaudeStoreState,
  payload: ClaudeEvent,
): Partial<ClaudeStoreState> {
  const out: Partial<ClaudeStoreState> = {};
  const p = asRecord(payload);
  const type = p?.type as string | undefined;

  if (prev.status === "running") {
    if (type === "system" && typeof p?.model === "string") {
      out.model = p.model as string;
    } else if (type === "assistant" || type === "user") {
      if (prev.agentState === "PLANNING") out.agentState = "EXECUTING";
    } else if (type === "stream_event") {
      const ev = asRecord(p?.event);
      const evType = ev?.type as string | undefined;
      if (
        evType === "content_block_start" ||
        evType === "content_block_delta"
      ) {
        if (prev.agentState === "PLANNING") out.agentState = "EXECUTING";
      }
      const cb = asRecord(ev?.content_block);
      if (cb?.type === "tool_use" && typeof cb.name === "string") {
        out.activeTool = cb.name as string;
      }
      if (evType === "content_block_stop") {
        out.activeTool = null;
      }
    } else if (type === "PreToolUse") {
      const toolName = (p?.tool_name as string | undefined) ?? null;
      out.activeTool = toolName;
      if (prev.agentState !== "EXECUTING") out.agentState = "EXECUTING";
    } else if (type === "PostToolUse") {
      out.activeTool = null;
    } else if (type === "result") {
      out.agentState = "COMPLETE";
    }
  }

  const tokens = extractTokens(payload);
  if (tokens !== null && tokens > prev.tokensUsed) {
    out.tokensUsed = tokens;
  }

  return out;
}

function appendEvent(payload: ClaudeEvent) {
  setState((s) => {
    const next = s.events.concat({
      id: nextId++,
      receivedAtMs: Date.now(),
      payload,
    });
    if (next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS);
    const delta = deriveLightTransitions(s, payload);
    return { ...s, events: next, ...delta };
  });

  // Transcript parsing — runs after the light state update so order is preserved.
  const p = asRecord(payload);
  if (!p) return;
  const type = p.type as string | undefined;
  if (type === "stream_event") processStreamEvent(p);
  else if (type === "result") processResultEvent(p);
}

function applyLifecycle(lc: ClaudeLifecycle) {
  switch (lc.kind) {
    case "started":
      if (completeTimer) {
        clearTimeout(completeTimer);
        completeTimer = null;
      }
      openBlocks.clear();
      setState((s) => ({
        ...s,
        status: "running",
        agentState: "PLANNING",
        startedAtMs: lc.started_at_ms,
        exitCode: null,
        lastError: null,
        tokensUsed: 0,
        activeTool: null,
      }));
      break;
    case "exited": {
      const ok = (lc.exit_code ?? 0) === 0;
      setState((s) => ({
        ...s,
        status: ok ? "idle" : "error",
        agentState:
          s.agentState === "COMPLETE" || ok ? "COMPLETE" : "ERROR",
        exitCode: lc.exit_code,
        activeTool: null,
      }));
      if (completeTimer) clearTimeout(completeTimer);
      completeTimer = setTimeout(() => {
        setState((s) =>
          s.agentState === "COMPLETE" || s.agentState === "ERROR"
            ? { ...s, agentState: "IDLE" }
            : s,
        );
        completeTimer = null;
      }, COMPLETE_HOLD_MS);
      break;
    }
    case "error":
      setState((s) => ({
        ...s,
        status: "error",
        agentState: "ERROR",
        lastError: lc.message,
      }));
      break;
    case "stderr":
      appendEvent({ type: "stderr", message: lc.message });
      break;
  }
}

let wired = false;
export function ensureWired() {
  if (wired) return;
  wired = true;
  void onClaudeEvent(appendEvent);
  void onClaudeLifecycle(applyLifecycle);
}

export const clearEvents = () =>
  setState((s) => ({ ...s, events: [] }));

export const clearTranscript = () => {
  openBlocks.clear();
  setState((s) => ({ ...s, transcript: [] }));
};

export function pushUserPrompt(text: string) {
  pushTranscript({
    kind: "user",
    id: nextEntryId++,
    ts: Date.now(),
    text,
  });
}

export function useClaudeStore<T>(selector: (s: ClaudeStoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getSnapshot()),
    () => selector(getSnapshot()),
  );
}
