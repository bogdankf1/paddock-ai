import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ClaudeModel = "opus" | "sonnet" | "haiku";

export type AgentStatus = {
  agent_id: string;
  started_at_ms: number;
};

export type ClaudeLifecycleKind =
  | { kind: "started"; started_at_ms: number }
  | { kind: "exited"; exit_code: number | null }
  | { kind: "error"; message: string }
  | { kind: "stderr"; message: string };

export type ClaudeLifecycle = ClaudeLifecycleKind & { agent_id: string };

export type ClaudeEventPayload = Record<string, unknown> & { type?: string };

export type ClaudeEvent = {
  agent_id: string;
  payload: ClaudeEventPayload;
};

export const runClaude = (prompt: string, model?: ClaudeModel) =>
  invoke<string>("claude_run", { prompt, model });

export const followUpClaude = (
  agentId: string,
  prompt: string,
  sessionId: string,
) =>
  invoke<void>("claude_followup", {
    agentId,
    prompt,
    sessionId,
  });

export const stopClaude = (agentId: string) =>
  invoke<void>("claude_stop", { agentId });

export const getStatus = () => invoke<AgentStatus[]>("claude_status");

export const onClaudeEvent = (
  handler: (e: ClaudeEvent) => void,
): Promise<UnlistenFn> =>
  listen<ClaudeEvent>("claude:event", (e) => handler(e.payload));

export const onClaudeLifecycle = (
  handler: (e: ClaudeLifecycle) => void,
): Promise<UnlistenFn> =>
  listen<ClaudeLifecycle>("claude:lifecycle", (e) => handler(e.payload));
