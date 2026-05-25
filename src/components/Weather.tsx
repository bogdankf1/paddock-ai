import { useAgentList, type AgentRecord } from "../state/claudeStore";

export type Weather = "sunny" | "overcast" | "rain" | "heavy_rain";

function deriveWeather(agents: AgentRecord[]): Weather {
  if (agents.length === 0) return "sunny";
  const errorCount = agents.filter(
    (a) => a.agentState === "ERROR" || a.status === "error",
  ).length;
  if (errorCount >= 2) return "heavy_rain";
  if (errorCount === 1) return "rain";
  const anyStderr = agents.some((a) =>
    a.events.some((e) => e.payload.type === "stderr"),
  );
  if (anyStderr) return "overcast";
  return "sunny";
}

const LABEL: Record<Weather, string> = {
  sunny: "clear",
  overcast: "overcast",
  rain: "yellow flag",
  heavy_rain: "red flag",
};

const TONE: Record<Weather, string> = {
  sunny: "text-neutral-500",
  overcast: "text-neutral-300",
  rain: "text-amber-400",
  heavy_rain: "text-red-400",
};

export function Weather() {
  const agents = useAgentList();
  const weather = deriveWeather(agents);

  return (
    <>
      <div
        className={`pointer-events-none absolute inset-0 z-[5] transition-opacity duration-700 weather-${weather}`}
        aria-hidden
      />
      <div className="pointer-events-none absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
        <span
          className={`h-2 w-2 rounded-full ${
            weather === "sunny"
              ? "bg-emerald-500"
              : weather === "overcast"
                ? "bg-neutral-400"
                : weather === "rain"
                  ? "bg-amber-400"
                  : "bg-red-500"
          }`}
        />
        <span className={TONE[weather]}>{LABEL[weather]}</span>
      </div>
    </>
  );
}
