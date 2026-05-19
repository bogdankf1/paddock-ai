import { useState, type FormEvent } from "react";
import { runClaude, stopClaude } from "../lib/claude";
import { pushUserPrompt, useClaudeStore } from "../state/claudeStore";

export function PromptBar() {
  const status = useClaudeStore((s) => s.status);
  const lastError = useClaudeStore((s) => s.lastError);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const running = status === "running";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!prompt.trim() || running || submitting) return;
    setSubmitting(true);
    try {
      await runClaude(prompt);
      pushUserPrompt(prompt);
      setPrompt("");
    } catch (err) {
      console.error("claude_run failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function onStop() {
    try {
      await stopClaude();
    } catch (err) {
      console.error("claude_stop failed:", err);
    }
  }

  const dotColor =
    status === "running"
      ? "bg-amber-400"
      : status === "error"
        ? "bg-red-500"
        : "bg-emerald-500";

  return (
    <form
      onSubmit={onSubmit}
      className="absolute inset-x-0 bottom-0 z-20 flex h-16 items-center gap-3 border-t border-neutral-800 bg-neutral-950/85 px-4 backdrop-blur"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-neutral-400">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span>{status}</span>
      </div>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={running}
        placeholder="Ask Claude Code…"
        className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600 disabled:opacity-50"
        autoFocus
      />
      <button
        type="submit"
        disabled={running || submitting || !prompt.trim()}
        className="rounded border border-emerald-700 bg-emerald-700/20 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-emerald-300 hover:bg-emerald-700/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Run
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={!running}
        className="rounded border border-red-800 bg-red-800/20 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-red-300 hover:bg-red-800/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Stop
      </button>
      {lastError && status === "error" && (
        <div className="max-w-[40ch] truncate font-mono text-xs text-red-400">
          {lastError}
        </div>
      )}
    </form>
  );
}
