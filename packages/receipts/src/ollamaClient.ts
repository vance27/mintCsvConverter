import { Ollama } from 'ollama';

/** Narrow, single-signature shape of the one Ollama call this package uses — same
 * testability pattern as SheetsClient's SpreadsheetsClient/ScriptClient interfaces
 * in packages/automation: real Ollama instances satisfy this narrower type, and
 * specs can pass a plain fake instead of a real chat overload set. */
export interface VisionChatClient {
  chat(request: {
    model: string;
    messages: { role: string; content: string; images?: string[] }[];
    format?: object;
  }): Promise<{ message: { content: string } }>;
}

/**
 * Model used for receipt extraction — swappable via OLLAMA_MODEL.
 *
 * `qwen2.5vl:7b` reliably misattributed a `N @ unitPrice` annotation to
 * the wrong neighboring item on a real Costco receipt (confirmed
 * reproducible across 3 identical attempts, including after prompt
 * tightening and a retry loop — see extractReconciled.ts) — a
 * spatial-grounding limit of the 7B model, not an instruction-following
 * gap. `qwen2.5vl:32b` got the same receipt fully correct on 2/2 clean
 * attempts, at the cost of ~28GB resident memory (vs a few GB for 7b) and
 * ~130-170s per call (vs a few seconds). `OLLAMA_MODEL=qwen2.5vl:7b` is
 * still worth setting on lower-memory machines or when speed matters more
 * than catching this specific failure mode.
 *
 * Not `llama3.2-vision`: its architecture (`mllama`) was dropped when
 * Ollama rewrote its inference engine around v0.30.0 and was never
 * implemented in the newer engine — every current Ollama version fails to
 * load it (`unknown model architecture: 'mllama'`), confirmed against a
 * real pull. It does still work on a manually-installed pre-rewrite
 * Ollama binary (confirmed against v0.23.3) and got this same receipt
 * right too, but isn't worth pursuing: it only accepts one image per
 * call (breaks multi-page receipts — this one is 2 pages), latency was
 * inconsistent (53s-5min+), and it requires maintaining an unmanaged,
 * un-updatable second Ollama install alongside the real one.
 */
export function defaultOllamaModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLLAMA_MODEL ?? 'qwen2.5vl:32b';
}

/** Builds a real client against a local Ollama server (default http://localhost:11434). */
export function createOllamaClient(env: NodeJS.ProcessEnv = process.env): VisionChatClient {
  return new Ollama({ host: env.OLLAMA_HOST });
}
