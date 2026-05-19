import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ClaudeStatus = {
  running: boolean;
  started_at_ms: number | null;
};

export type ClaudeLifecycle =
  | { kind: "started"; started_at_ms: number }
  | { kind: "exited"; exit_code: number | null }
  | { kind: "error"; message: string }
  | { kind: "stderr"; message: string };

export type ClaudeEvent = Record<string, unknown> & { type?: string };

export const runClaude = (prompt: string) =>
  invoke<void>("claude_run", { prompt });

export const stopClaude = () => invoke<void>("claude_stop");

export const getStatus = () => invoke<ClaudeStatus>("claude_status");

export const onClaudeEvent = (
  handler: (e: ClaudeEvent) => void,
): Promise<UnlistenFn> =>
  listen<ClaudeEvent>("claude:event", (e) => handler(e.payload));

export const onClaudeLifecycle = (
  handler: (e: ClaudeLifecycle) => void,
): Promise<UnlistenFn> =>
  listen<ClaudeLifecycle>("claude:lifecycle", (e) => handler(e.payload));
