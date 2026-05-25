import { useEffect, useRef, useState, type FormEvent } from "react";
import { followUpClaude } from "../lib/claude";
import {
  clearTranscript,
  pushFollowUp,
  useSelectedAgent,
  type TranscriptEntry,
} from "../state/claudeStore";

function summarizeInput(input: string) {
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
    // Body duplicates the assistant_text block; suppress rendering.
    // Cost/duration live on the agent card; keep the entry in state for debug only.
    if (entry.success) return null;
    return (
      <div className="border-b border-neutral-900 px-3 py-2 text-xs text-red-300">
        <span className="uppercase tracking-widest">Failed</span>
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

function hex(n: number) {
  return `#${n.toString(16).padStart(6, "0")}`;
}

export function Transcript() {
  const agent = useSelectedAgent();
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [collapsed, setCollapsed] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const transcript = agent?.transcript ?? [];
  const running = agent?.status === "running";
  const canReply =
    !!agent && !running && !!agent.sessionId && !sending;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  useEffect(() => {
    setReply("");
  }, [agent?.id]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  async function onReplySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = reply.trim();
    if (!text || !agent || !agent.sessionId || sending) return;
    setSending(true);
    try {
      await followUpClaude(agent.id, text, agent.sessionId);
      pushFollowUp(agent.id, text);
      setReply("");
    } catch (err) {
      console.error("claude_followup failed:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="absolute right-4 top-4 z-20 flex w-[500px] max-w-[44vw] flex-col overflow-hidden rounded border border-neutral-800 bg-neutral-950/85 text-neutral-300 backdrop-blur">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 font-mono">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-neutral-400">
          {agent && (
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: hex(agent.color) }}
            />
          )}
          <span>
            {agent ? `Transcript · agent ${agent.index + 1}` : "Transcript"}
          </span>
          {running && <span className="text-amber-400">· live</span>}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => agent && clearTranscript(agent.id)}
            disabled={!agent}
            className="rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
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
        <>
          <div
            ref={listRef}
            onScroll={onScroll}
            className="max-h-[60vh] min-h-[120px] overflow-y-auto"
          >
            {!agent ? (
              <div className="px-3 py-6 text-center font-mono text-xs text-neutral-600">
                no agent selected
              </div>
            ) : transcript.length === 0 ? (
              <div className="px-3 py-6 text-center font-mono text-xs text-neutral-600">
                transcript empty — submit a prompt to start
              </div>
            ) : (
              transcript.map((e) => <EntryView key={e.id} entry={e} />)
            )}
          </div>
          {agent && (
            <form
              onSubmit={onReplySubmit}
              className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2"
            >
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={
                  running
                    ? "agent is running…"
                    : !agent.sessionId
                      ? "waiting for session…"
                      : `Reply to agent ${agent.index + 1}…`
                }
                disabled={!canReply}
                className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!canReply || !reply.trim()}
                className="rounded border border-emerald-700 bg-emerald-700/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-300 hover:bg-emerald-700/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
