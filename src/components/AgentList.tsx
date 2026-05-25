import { stopClaude } from "../lib/claude";
import {
  selectAgent,
  useAgentList,
  useClaudeStore,
  type AgentRecord,
} from "../state/claudeStore";

function hex(n: number) {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function statusTone(a: AgentRecord) {
  if (a.agentState === "ERROR") return "text-red-400";
  if (a.agentState === "EXECUTING") return "text-emerald-400";
  if (a.agentState === "PLANNING") return "text-amber-400";
  if (a.agentState === "COMPLETE") return "text-emerald-300";
  return "text-neutral-500";
}

function AgentCard({ agent }: { agent: AgentRecord }) {
  const selectedId = useClaudeStore((s) => s.selectedId);
  const selected = selectedId === agent.id;
  const running = agent.status === "running";
  const ratio = Math.max(0, Math.min(1, agent.tokensUsed / agent.tankCapacity));
  const remaining = Math.max(0, 1 - ratio);
  const barColor =
    remaining > 0.5
      ? "bg-emerald-500"
      : remaining > 0.2
        ? "bg-amber-500"
        : "bg-red-500";

  async function onStop(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await stopClaude(agent.id);
    } catch (err) {
      console.error("claude_stop failed:", err);
    }
  }

  return (
    <button
      type="button"
      onClick={() => selectAgent(agent.id)}
      className={`group w-full overflow-hidden rounded border text-left font-mono backdrop-blur transition ${
        selected
          ? "border-neutral-600 bg-neutral-900/90"
          : "border-neutral-800 bg-neutral-950/85 hover:border-neutral-700"
      }`}
    >
      <div className="flex items-stretch">
        <div
          className="w-1.5 shrink-0"
          style={{ backgroundColor: hex(agent.color) }}
        />
        <div className="flex-1 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-neutral-300">
              Agent {agent.index + 1}
            </span>
            <span
              className={`text-[10px] uppercase tracking-widest ${statusTone(agent)}`}
            >
              {agent.agentState.toLowerCase()}
            </span>
          </div>
          <div className="mt-1 truncate text-[11px] text-neutral-500">
            {agent.prompt || "—"}
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral-900">
            <div
              className={`h-full transition-[width] duration-200 ${barColor}`}
              style={{ width: `${remaining * 100}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-500">
            <span>{formatTokens(agent.tokensUsed)} tok</span>
            {agent.activeTool ? (
              <span className="text-violet-400">{agent.activeTool}</span>
            ) : agent.model ? (
              <span className="text-neutral-600">{agent.model}</span>
            ) : null}
          </div>
          {running && (
            <div
              role="button"
              tabIndex={0}
              onClick={onStop}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onStop(e as never);
              }}
              className="mt-2 inline-block cursor-pointer rounded border border-red-900/70 bg-red-900/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-900/40"
            >
              stop
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export function AgentList() {
  const agents = useAgentList();

  if (agents.length === 0) {
    return (
      <div className="absolute left-4 top-12 z-20 w-[260px] rounded border border-neutral-800 bg-neutral-950/85 px-3 py-3 font-mono text-xs text-neutral-500 backdrop-blur">
        no agents — submit a prompt to start
      </div>
    );
  }

  return (
    <div className="absolute left-4 top-12 z-20 flex w-[260px] max-h-[80vh] flex-col gap-2 overflow-y-auto">
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} />
      ))}
    </div>
  );
}
