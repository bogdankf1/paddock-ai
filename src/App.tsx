import { useEffect } from "react";
import { Track } from "./components/Track";
import { PromptBar } from "./components/PromptBar";
import { DebugPanel } from "./components/DebugPanel";
import { AgentList } from "./components/AgentList";
import { Transcript } from "./components/Transcript";
import { Weather } from "./components/Weather";
import { ensureWired } from "./state/claudeStore";
import "./App.css";

function App() {
  useEffect(() => {
    ensureWired();
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-200">
      <Track />
      <Weather />
      <div className="pointer-events-none absolute left-4 top-4 z-10 font-mono text-xs uppercase tracking-widest text-neutral-500">
        Paddock AI
      </div>
      <AgentList />
      <Transcript />
      <DebugPanel />
      <PromptBar />
    </main>
  );
}

export default App;
