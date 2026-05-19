import { useClaudeStore } from "../state/claudeStore";

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function FuelGauge() {
  const used = useClaudeStore((s) => s.tokensUsed);
  const capacity = useClaudeStore((s) => s.tankCapacity);
  const agentState = useClaudeStore((s) => s.agentState);
  const model = useClaudeStore((s) => s.model);
  const activeTool = useClaudeStore((s) => s.activeTool);

  const ratio = Math.max(0, Math.min(1, used / capacity));
  const remaining = Math.max(0, 1 - ratio);

  const barColor =
    remaining > 0.5
      ? "bg-emerald-500"
      : remaining > 0.2
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="absolute left-4 top-12 z-20 w-[280px] rounded border border-neutral-800 bg-neutral-950/85 p-3 font-mono text-xs text-neutral-300 backdrop-blur">
      <div className="mb-2 flex items-center justify-between text-neutral-500 uppercase tracking-widest">
        <span>Fuel</span>
        <span>{formatTokens(used)} / {formatTokens(capacity)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-900">
        <div
          className={`h-full transition-[width] duration-200 ${barColor}`}
          style={{ width: `${remaining * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-neutral-500">
        <span className="uppercase tracking-widest">
          {agentState.toLowerCase()}
        </span>
        <span>
          {activeTool ? (
            <span className="text-violet-400">{activeTool}</span>
          ) : model ? (
            <span className="text-neutral-600">{model}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
