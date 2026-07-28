import { Ollama } from 'ollama';

/** Narrow, single-signature shape of the one Ollama call this package uses — same
 * testability pattern as SheetsClient's SpreadsheetsClient/ScriptClient interfaces
 * in packages/automation: real Ollama instances satisfy this narrower type, and
 * specs can pass a plain fake instead of a real chat overload set.
 *
 * The optional `signal` lets a caller (UploadQueue's cancel) abort an
 * in-flight extraction. The `ollama` npm client only exposes real
 * cancellation for its streaming API (its non-streaming `chat()` never
 * constructs an AbortController at all — confirmed by reading its source),
 * so `createOllamaClient` below always requests `stream: true` under the
 * hood and reassembles the chunks itself, purely to get an abortable
 * request; callers of this interface still see one plain non-streaming
 * response, same as before. */
export interface VisionChatClient {
    chat(
        request: {
            model: string;
            messages: { role: string; content: string; images?: string[] }[];
            format?: object;
        },
        signal?: AbortSignal,
    ): Promise<{ message: { content: string } }>;
}

/** How often to log a "still working" heartbeat while chunks are streaming in — real progress, not just a stall guess. */
const PROGRESS_LOG_INTERVAL_MS = 15_000;

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
    const ollama = new Ollama({ host: env.OLLAMA_HOST });
    return {
        async chat(request, signal) {
            signal?.throwIfAborted();
            const stream = await ollama.chat({ ...request, stream: true });
            // signal may have fired while the line above was awaiting the
            // connection to even open, before there was a stream to abort — catch
            // that race here rather than only reacting to a later 'abort' event.
            if (signal?.aborted) {
                stream.abort();
            }
            const onAbort = () => stream.abort();
            signal?.addEventListener('abort', onAbort, { once: true });
            try {
                let content = '';
                let lastLogAt = Date.now();
                for await (const chunk of stream) {
                    content += chunk.message.content;
                    const now = Date.now();
                    if (now - lastLogAt >= PROGRESS_LOG_INTERVAL_MS) {
                        console.log(`[ollama] still streaming — ${content.length} chars received so far`);
                        lastLogAt = now;
                    }
                }
                return { message: { content } };
            } finally {
                signal?.removeEventListener('abort', onAbort);
            }
        },
    };
}

/** Narrow shape of the one Ollama call used to list locally pulled models — same testability pattern as VisionChatClient above. */
export interface OllamaModelLister {
    list(): Promise<{ models: { name: string }[] }>;
}

/** Builds a real OllamaModelLister against a local Ollama server (default http://localhost:11434) — a thin wrapper over its /api/tags. */
export function createOllamaModelLister(env: NodeJS.ProcessEnv = process.env): OllamaModelLister {
    return new Ollama({ host: env.OLLAMA_HOST });
}

/** Names of every model currently pulled/installed on the local Ollama server, for the Model picker (docs/adr/0007). */
export async function listInstalledModels(lister: OllamaModelLister): Promise<string[]> {
    const { models } = await lister.list();
    return models.map((m) => m.name).sort();
}
