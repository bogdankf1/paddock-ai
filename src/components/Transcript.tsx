import { useEffect, useRef, useState } from "react";
import {
  clearTranscript,
  useClaudeStore,
  type TranscriptEntry,
} from "../state/claudeStore";

function formatUsd(n: number | null) {
  if (n == null) return null;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function formatTokens(n: number | null) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function summarizeInput(input: string) {
  // Try to parse the streamed JSON; if it isn't valid yet, show as-is truncated.
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) return null;
      return entries
        .map(([k, v]) => {
          const s =
            typeof v === "string"
              ? v.length > 80
                ? `${v.slice(0, 80)}…`
                : v
              : JSON.stringify(v);
          return `${k}: ${s}`;
        })
        .join("  ·  ");
    }
  } catch {
    // streaming, not yet valid JSON
  }
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

function EntryView({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === "user") {
    return (
      <div className="border-b border-neutral-900 px-3 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">
          You
        </div>
        <div className="whitespace-pre-wrap text-sm text-neutral-100">
          {entry.text}
        </div>
      </div>
    );
  }

  if (entry.kind === "assistant_text") {
    return (
      <div className="border-b border-neutral-900 px-3 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-emerald-400">
          Claude
        </div>
        <div className="whitespace-pre-wrap text-sm text-neutral-200">
          {entry.text}
          {!entry.complete && (
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-emerald-400 align-middle" />
          )}
        </div>
      </div>
    );
  }

  if (entry.kind === "tool_use") {
    const summary = summarizeInput(entry.input);
    return (
      <div className="border-b border-neutral-900 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-violet-400">▸</span>
          <span className="font-semibold text-violet-300">{entry.tool}</span>
          {!entry.complete && (
            <span className="text-neutral-600">streaming…</span>
          )}
        </div>
        {summary && (
          <div className="mt-1 truncate font-mono text-[11px] text-neutral-500">
            {summary}
          </div>
        )}
      </div>
    );
  }

  if (entry.kind === "result") {
    const parts: string[] = [];
    const tokens = formatTokens(entry.totalTokens);
    const cost = formatUsd(entry.totalCostUsd);
    if (tokens) parts.push(`${tokens} tokens`);
    if (cost) parts.push(cost);
    if (entry.durationSec != null)
      parts.push(`${entry.durationSec.toFixed(2)}s`);
    const stamp = parts.join("  ·  ");
    return (
      <div
        className={`border-b border-neutral-900 px-3 py-2 text-xs ${
          entry.success ? "text-amber-300" : "text-red-300"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="uppercase tracking-widest">
            {entry.success ? "Done" : "Failed"}
          </span>
          <span className="text-neutral-500">{stamp}</span>
        </div>
        {entry.message && (
          <div className="mt-1 whitespace-pre-wrap text-neutral-400">
            {entry.message}
          </div>
        )}
      </div>
    );
  }

  return null;
}

export function Transcript() {
  const transcript = useClaudeStore((s) => s.transcript);
  const status = useClaudeStore((s) => s.status);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <div className="absolute right-4 top-4 z-20 flex w-[500px] max-w-[44vw] flex-col overflow-hidden rounded border border-neutral-800 bg-neutral-950/85 text-neutral-300 backdrop-blur">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 font-mono">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-neutral-400">
          <span>Transcript</span>
          {status === "running" && (
            <span className="text-amber-400">· live</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={clearTranscript}
            className="rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            clear
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            {collapsed ? "expand" : "collapse"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div
          ref={listRef}
          onScroll={onScroll}
          className="max-h-[70vh] min-h-[120px] overflow-y-auto"
        >
          {transcript.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-xs text-neutral-600">
              transcript empty — submit a prompt to start
            </div>
          ) : (
            transcript.map((e) => <EntryView key={e.id} entry={e} />)
          )}
        </div>
      )}
    </div>
  );
}
