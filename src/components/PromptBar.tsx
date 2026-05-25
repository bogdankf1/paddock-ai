import { useState, type FormEvent } from "react";
import { runClaude, type ClaudeModel } from "../lib/claude";
import { registerAgent, useAgentList } from "../state/claudeStore";

const MODELS: { value: ClaudeModel; label: string }[] = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

export function PromptBar() {
  const agents = useAgentList();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ClaudeModel>("opus");
  const [submitting, setSubmitting] = useState(false);

  const runningCount = agents.filter((a) => a.status === "running").length;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const agentId = await runClaude(text, model);
      registerAgent(agentId, text, Date.now(), model);
      setPrompt("");
    } catch (err) {
      console.error("claude_run failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  const dotColor = runningCount > 0 ? "bg-amber-400" : "bg-emerald-500";
  const label =
    runningCount > 0
      ? `${runningCount} running`
      : agents.length > 0
        ? "idle"
        : "ready";

  return (
    <form
      onSubmit={onSubmit}
      className="absolute inset-x-0 bottom-0 z-20 flex h-16 items-center gap-3 border-t border-neutral-800 bg-neutral-950/85 px-4 backdrop-blur"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-neutral-400">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span>{label}</span>
      </div>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={
          runningCount > 0
            ? `Launch another agent (${runningCount} running)…`
            : "Ask Claude Code…"
        }
        className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        autoFocus
      />
      <select
        value={model}
        onChange={(e) => setModel(e.target.value as ClaudeModel)}
        className="rounded border border-neutral-800 bg-neutral-900 px-2 py-2 font-mono text-xs uppercase tracking-widest text-neutral-300 outline-none hover:border-neutral-700 focus:border-neutral-600"
        title="Model for the next agent"
      >
        {MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={submitting || !prompt.trim()}
        className="rounded border border-emerald-700 bg-emerald-700/20 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-emerald-300 hover:bg-emerald-700/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {runningCount > 0 ? "Run +" : "Run"}
      </button>
    </form>
  );
}
