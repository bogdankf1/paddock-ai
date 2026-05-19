import { Track } from "./components/Track";
import "./App.css";

function App() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-200">
      <Track />
      <div className="pointer-events-none absolute left-4 top-4 z-10 font-mono text-xs uppercase tracking-widest text-neutral-500">
        Paddock AI · placeholder lap
      </div>
    </main>
  );
}

export default App;
