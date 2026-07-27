import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatMock = vi.fn();
vi.mock('ollama', () => ({
  Ollama: class {
    chat = chatMock;
  },
}));

// Vitest hoists vi.mock() above imports at compile time, so ollamaClient.js
// (imported below, after the mock is declared) picks up the mocked 'ollama'.
import { createOllamaClient } from './ollamaClient.js';

type Chunk = { message: { content: string } };

/** A completing stand-in for the real `ollama` package's AbortableAsyncIterator — yields the given chunks, then ends normally. */
function fakeCompletingStream(chunks: Chunk[]): AsyncIterable<Chunk> & { abort: ReturnType<typeof vi.fn> } {
  let index = 0;
  return {
    abort: vi.fn(),
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<Chunk>> {
          if (index < chunks.length) {
            return Promise.resolve({ value: chunks[index++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

/** A stand-in that yields one chunk, then hangs like a real stream waiting on the next network chunk would — only abort() ever settles it, mirroring a genuine mid-request cancel. */
function fakeHangingStream(firstChunk: Chunk): AsyncIterable<Chunk> & { abort: ReturnType<typeof vi.fn> } {
  let yielded = false;
  let pendingReject: ((error: Error) => void) | null = null;
  const abort = vi.fn(() => {
    pendingReject?.(new Error('This operation was aborted'));
  });
  return {
    abort,
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<Chunk>> {
          if (!yielded) {
            yielded = true;
            return Promise.resolve({ value: firstChunk, done: false });
          }
          return new Promise((_resolve, reject) => {
            pendingReject = reject;
          });
        },
      };
    },
  };
}

describe('createOllamaClient', () => {
  beforeEach(() => {
    chatMock.mockReset();
  });

  it('requests streaming under the hood and reassembles the chunks into one plain response', async () => {
    chatMock.mockResolvedValue(fakeCompletingStream([{ message: { content: '{"a":' } }, { message: { content: '1}' } }]));
    const client = createOllamaClient({});

    const result = await client.chat({ model: 'qwen2.5vl:32b', messages: [{ role: 'user', content: 'hi' }] });

    expect(result).toEqual({ message: { content: '{"a":1}' } });
    expect(chatMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen2.5vl:32b', stream: true }));
  });

  it('rejects immediately without calling Ollama at all when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createOllamaClient({});

    await expect(client.chat({ model: 'm', messages: [] }, controller.signal)).rejects.toThrow();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('aborts the live stream when the signal fires mid-request, freeing it instead of leaving it to finish unread', async () => {
    const stream = fakeHangingStream({ message: { content: 'partial' } });
    chatMock.mockResolvedValue(stream);
    const controller = new AbortController();
    const client = createOllamaClient({});

    const pending = client.chat({ model: 'm', messages: [] }, controller.signal);
    // Let the first chunk land and the loop start waiting on the next one before cancelling.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toThrow('aborted');
    expect(stream.abort).toHaveBeenCalledTimes(1);
  });
});
