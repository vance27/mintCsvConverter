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

/** Model used for receipt extraction — swappable via OLLAMA_MODEL. */
export function defaultOllamaModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLLAMA_MODEL ?? 'llama3.2-vision';
}

/** Builds a real client against a local Ollama server (default http://localhost:11434). */
export function createOllamaClient(env: NodeJS.ProcessEnv = process.env): VisionChatClient {
  return new Ollama({ host: env.OLLAMA_HOST });
}
