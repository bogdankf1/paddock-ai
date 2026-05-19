import { useEffect, useRef, useState } from "react";
import { clearEvents, useClaudeStore } from "../state/claudeStore";

const TYPE_COLORS: Record<string, string> = {
  system: "text-sky-400",
  user: "text-neutral-400",
  assistant: "text-emerald-400",
  stream_event: "text-violet-400",
  result: "text-amber-400",
  stderr: "text-red-400",
  raw: "text-neutral-500",
};

export function DebugPanel() {
  const events = useClaudeStore((s) => s.events);
  const status = useClaudeStore((s) => s.status);
  const exitCode = useClaudeStore((s) => s.exitCode);
  const [collapsed, setCollapsed] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <div className="absolute bottom-20 right-4 z-20 w-[500px] max-w-[44vw] overflow-hidden rounded border border-neutral-800 bg-neutral-950/85 font-mono text-xs text-neutral-300 backdrop-blur">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-2 uppercase tracking-widest text-neutral-400">
          <span>Raw events ({events.length})</span>
          {status === "running" && (
            <span className="text-amber-400">· running</span>
          )}
          {status === "error" && (
            <span className="text-red-400">· error {exitCode ?? ""}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clearEvents}
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
          className="max-h-[40vh] overflow-y-auto px-3 py-2"
        >
          {events.length === 0 ? (
            <div className="py-4 text-center text-neutral-600">
              waiting for events…
            </div>
          ) : (
            events.map((e) => {
              const type = String(e.payload.type ?? "raw");
              const color = TYPE_COLORS[type] ?? "text-neutral-400";
              return (
                <div
                  key={e.id}
                  className="mb-1 border-b border-neutral-900 pb-1 last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <span className={`uppercase ${color}`}>{type}</span>
                    <span className="text-neutral-600">
                      {new Date(e.receivedAtMs).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-neutral-400">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
