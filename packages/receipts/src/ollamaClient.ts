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
 * Not `llama3.2-vision`: its architecture (`mllama`) was dropped when
 * Ollama rewrote its inference engine around v0.30.0 and was never
 * implemented in the newer engine — every current Ollama version fails to
 * load it (`unknown model architecture: 'mllama'`), confirmed against a
 * real pull, not just docs. Qwen2.5-VL uses a currently-supported
 * architecture and is specifically tuned for documents/OCR/structured
 * visual content, which is a better fit for receipts than the general-
 * purpose vision models anyway.
 */
export function defaultOllamaModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLLAMA_MODEL ?? 'qwen2.5vl:7b';
}

/** Builds a real client against a local Ollama server (default http://localhost:11434). */
export function createOllamaClient(env: NodeJS.ProcessEnv = process.env): VisionChatClient {
  return new Ollama({ host: env.OLLAMA_HOST });
}
