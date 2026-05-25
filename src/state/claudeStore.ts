import { useSyncExternalStore } from "react";
import {
  onClaudeEvent,
  onClaudeLifecycle,
  type ClaudeEvent,
  type ClaudeEventPayload,
  type ClaudeLifecycle,
  type ClaudeModel,
} from "../lib/claude";

const MAX_EVENTS = 500;
const FUEL_TANK_TOKENS = 200_000;
const COMPLETE_HOLD_MS = 4000;

export const AGENT_PALETTE = [
  0xef4444, // red
  0x3b82f6, // blue
  0xf59e0b, // amber
  0x10b981, // emerald
  0xa855f7, // violet
  0xec4899, // pink
  0x06b6d4, // cyan
  0xfb923c, // orange
] as const;

export type StoredEvent = {
  id: number;
  receivedAtMs: number;
  payload: ClaudeEventPayload;
};

export type AgentState =
  | "IDLE"
  | "PLANNING"
  | "EXECUTING"
  | "COMPLETE"
  | "ERROR";

export type Status = "idle" | "running" | "error";

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

export type AgentRecord = {
  id: string;
  index: number;
  color: number;
  prompt: string;
  startedAtMs: number;
  status: Status;
  agentState: AgentState;
  exitCode: number | null;
  lastError: string | null;
  tokensUsed: number;
  tankCapacity: number;
  model: string | null;
  requestedModel: ClaudeModel;
  sessionId: string | null;
  activeTool: string | null;
  transcript: TranscriptEntry[];
  events: StoredEvent[];
};

export type ClaudeStoreState = {
  agents: Record<string, AgentRecord>;
  agentOrder: string[];
  selectedId: string | null;
};

const listeners = new Set<() => void>();
let state: ClaudeStoreState = {
  agents: {},
  agentOrder: [],
  selectedId: null,
};
let cachedAgentList: AgentRecord[] = [];
let nextEventId = 1;
let nextEntryId = 1;

const completeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const openBlocks = new Map<string, Map<number, number>>();

function recomputeCaches() {
  cachedAgentList = state.agentOrder
    .map((id) => state.agents[id])
    .filter((a): a is AgentRecord => Boolean(a));
}

function setState(updater: (s: ClaudeStoreState) => ClaudeStoreState) {
  const next = updater(state);
  if (next === state) return;
  state = next;
  recomputeCaches();
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

function extractTokens(payload: ClaudeEventPayload): number | null {
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

function updateAgent(
  id: string,
  updater: (a: AgentRecord) => AgentRecord,
) {
  setState((s) => {
    const existing = s.agents[id];
    if (!existing) return s;
    return { ...s, agents: { ...s.agents, [id]: updater(existing) } };
  });
}

function pushTranscript(id: string, entry: TranscriptEntry) {
  updateAgent(id, (a) => ({ ...a, transcript: a.transcript.concat(entry) }));
}

function updateEntry(
  id: string,
  entryId: number,
  updater: (e: TranscriptEntry) => TranscriptEntry,
) {
  updateAgent(id, (a) => ({
    ...a,
    transcript: a.transcript.map((e) => (e.id === entryId ? updater(e) : e)),
  }));
}

function processStreamEvent(agentId: string, p: Record<string, unknown>) {
  const ev = asRecord(p.event);
  if (!ev) return;
  const evType = ev.type as string | undefined;

  let blocks = openBlocks.get(agentId);
  if (!blocks) {
    blocks = new Map();
    openBlocks.set(agentId, blocks);
  }

  if (evType === "message_start") {
    blocks.clear();
    return;
  }

  if (evType === "content_block_start") {
    const idx = ev.index as number | undefined;
    const cb = asRecord(ev.content_block);
    if (idx == null || !cb) return;
    const cbType = cb.type as string | undefined;
    if (cbType === "text") {
      const entryId = nextEntryId++;
      blocks.set(idx, entryId);
      pushTranscript(agentId, {
        kind: "assistant_text",
        id: entryId,
        ts: Date.now(),
        text: "",
        complete: false,
      });
    } else if (cbType === "tool_use") {
      const entryId = nextEntryId++;
      blocks.set(idx, entryId);
      pushTranscript(agentId, {
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
    const entryId = blocks.get(idx);
    if (entryId == null) return;
    const delta = asRecord(ev.delta);
    if (!delta) return;
    const dType = delta.type as string | undefined;
    if (dType === "text_delta" && typeof delta.text === "string") {
      const chunk = delta.text as string;
      updateEntry(agentId, entryId, (e) =>
        e.kind === "assistant_text" ? { ...e, text: e.text + chunk } : e,
      );
    } else if (
      dType === "input_json_delta" &&
      typeof delta.partial_json === "string"
    ) {
      const chunk = delta.partial_json as string;
      updateEntry(agentId, entryId, (e) =>
        e.kind === "tool_use" ? { ...e, input: e.input + chunk } : e,
      );
    }
    return;
  }

  if (evType === "content_block_stop") {
    const idx = ev.index as number | undefined;
    if (idx == null) return;
    const entryId = blocks.get(idx);
    if (entryId != null) {
      updateEntry(agentId, entryId, (e) =>
        "complete" in e ? { ...e, complete: true } : e,
      );
      blocks.delete(idx);
    }
  }
}

function processResultEvent(agentId: string, p: Record<string, unknown>) {
  pushTranscript(agentId, {
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
  prev: AgentRecord,
  payload: ClaudeEventPayload,
): Partial<AgentRecord> {
  const out: Partial<AgentRecord> = {};
  const p = asRecord(payload);
  const type = p?.type as string | undefined;

  if (
    type === "system" &&
    typeof p?.session_id === "string" &&
    !prev.sessionId
  ) {
    out.sessionId = p.session_id as string;
  }

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

function appendEvent(agentId: string, payload: ClaudeEventPayload) {
  setState((s) => {
    const a = s.agents[agentId];
    if (!a) return s;
    const events = a.events.concat({
      id: nextEventId++,
      receivedAtMs: Date.now(),
      payload,
    });
    if (events.length > MAX_EVENTS)
      events.splice(0, events.length - MAX_EVENTS);
    const delta = deriveLightTransitions(a, payload);
    return {
      ...s,
      agents: { ...s.agents, [agentId]: { ...a, events, ...delta } },
    };
  });

  const p = asRecord(payload);
  if (!p) return;
  const type = p.type as string | undefined;
  if (type === "stream_event") processStreamEvent(agentId, p);
  else if (type === "result") processResultEvent(agentId, p);
}

function ensureAgent(
  agentId: string,
  startedAtMs: number,
  requestedModel: ClaudeModel = "opus",
) {
  setState((s) => {
    if (s.agents[agentId]) return s;
    const index = s.agentOrder.length;
    const color = AGENT_PALETTE[index % AGENT_PALETTE.length];
    const agent: AgentRecord = {
      id: agentId,
      index,
      color,
      prompt: "",
      startedAtMs,
      status: "running",
      agentState: "PLANNING",
      exitCode: null,
      lastError: null,
      tokensUsed: 0,
      tankCapacity: FUEL_TANK_TOKENS,
      model: null,
      requestedModel,
      sessionId: null,
      activeTool: null,
      transcript: [],
      events: [],
    };
    return {
      ...s,
      agents: { ...s.agents, [agentId]: agent },
      agentOrder: [...s.agentOrder, agentId],
      selectedId: s.selectedId ?? agentId,
    };
  });
}

function applyLifecycle(lc: ClaudeLifecycle) {
  const { agent_id: agentId } = lc;
  switch (lc.kind) {
    case "started": {
      const existing = state.agents[agentId];
      if (existing) {
        const timer = completeTimers.get(agentId);
        if (timer) {
          clearTimeout(timer);
          completeTimers.delete(agentId);
        }
        openBlocks.get(agentId)?.clear();
        updateAgent(agentId, (a) => ({
          ...a,
          status: "running",
          agentState: "PLANNING",
          startedAtMs: lc.started_at_ms,
          exitCode: null,
          lastError: null,
          tokensUsed: 0,
          activeTool: null,
        }));
      } else {
        ensureAgent(agentId, lc.started_at_ms);
      }
      break;
    }
    case "exited": {
      const ok = (lc.exit_code ?? 0) === 0;
      updateAgent(agentId, (a) => ({
        ...a,
        status: ok ? "idle" : "error",
        agentState:
          a.agentState === "COMPLETE" || ok ? "COMPLETE" : "ERROR",
        exitCode: lc.exit_code,
        activeTool: null,
      }));
      const existing = completeTimers.get(agentId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        updateAgent(agentId, (a) =>
          a.agentState === "COMPLETE" || a.agentState === "ERROR"
            ? { ...a, agentState: "IDLE" }
            : a,
        );
        completeTimers.delete(agentId);
      }, COMPLETE_HOLD_MS);
      completeTimers.set(agentId, timer);
      break;
    }
    case "error":
      updateAgent(agentId, (a) => ({
        ...a,
        status: "error",
        agentState: "ERROR",
        lastError: lc.message,
      }));
      break;
    case "stderr":
      appendEvent(agentId, { type: "stderr", message: lc.message });
      break;
  }
}

let wired = false;
export function ensureWired() {
  if (wired) return;
  wired = true;
  void onClaudeEvent((e: ClaudeEvent) => appendEvent(e.agent_id, e.payload));
  void onClaudeLifecycle(applyLifecycle);
}

export function registerAgent(
  agentId: string,
  prompt: string,
  startedAtMs: number,
  requestedModel: ClaudeModel = "opus",
) {
  ensureAgent(agentId, startedAtMs, requestedModel);
  updateAgent(agentId, (a) => ({
    ...a,
    prompt,
    requestedModel,
    transcript: a.transcript.concat({
      kind: "user",
      id: nextEntryId++,
      ts: Date.now(),
      text: prompt,
    }),
  }));
  setState((s) => ({ ...s, selectedId: agentId }));
}

export function pushFollowUp(agentId: string, prompt: string) {
  updateAgent(agentId, (a) => ({
    ...a,
    transcript: a.transcript.concat({
      kind: "user",
      id: nextEntryId++,
      ts: Date.now(),
      text: prompt,
    }),
  }));
}

export function selectAgent(agentId: string) {
  setState((s) =>
    s.agents[agentId] ? { ...s, selectedId: agentId } : s,
  );
}

export function clearEvents(agentId: string) {
  updateAgent(agentId, (a) => ({ ...a, events: [] }));
}

export function clearTranscript(agentId: string) {
  openBlocks.get(agentId)?.clear();
  updateAgent(agentId, (a) => ({ ...a, transcript: [] }));
}

export function useClaudeStore<T>(selector: (s: ClaudeStoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getSnapshot()),
    () => selector(getSnapshot()),
  );
}

export function useAgent(id: string | null): AgentRecord | null {
  return useClaudeStore((s) => (id ? (s.agents[id] ?? null) : null));
}

export function useSelectedAgent(): AgentRecord | null {
  return useClaudeStore((s) =>
    s.selectedId ? (s.agents[s.selectedId] ?? null) : null,
  );
}

export function useAgentList(): AgentRecord[] {
  return useClaudeStore(() => cachedAgentList);
}
