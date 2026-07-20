import { parseFileCore, type ProgressFn } from './parserCore';

interface PendingParse {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  onProgress?: ProgressFn;
}

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingParse>();

function failAllPending(message: string) {
  for (const req of pending.values()) {
    req.reject(new Error(message));
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });

  worker.onmessage = (e: MessageEvent<{ id: number; type: string; progress?: number; text?: string; message?: string }>) => {
    const { id, type, progress, text, message } = e.data;
    const req = pending.get(id);
    if (!req) return;

    if (type === 'progress') {
      req.onProgress?.(progress ?? 0);
    } else if (type === 'done') {
      pending.delete(id);
      req.resolve(text ?? '');
    } else if (type === 'error') {
      pending.delete(id);
      req.reject(new Error(message || 'Failed to parse file.'));
    }
  };

  // If the worker itself dies (e.g. out of memory on a massive file), reject the
  // in-flight parses and discard it so the next parse starts a fresh worker.
  worker.onerror = () => {
    failAllPending('The file is too large or complex to parse — the parser ran out of memory.');
    worker?.terminate();
    worker = null;
  };

  return worker;
}

export function parseFile(file: File, onProgress?: ProgressFn): Promise<string> {
  if (typeof Worker === 'undefined') {
    return parseFileCore(file, onProgress);
  }

  return new Promise<string>((resolve, reject) => {
    const id = ++nextRequestId;
    pending.set(id, { resolve, reject, onProgress });
    try {
      getWorker().postMessage({ id, file });
    } catch (err) {
      pending.delete(id);
      // Structured clone / worker startup failed — fall back to the main thread.
      parseFileCore(file, onProgress).then(resolve, reject);
    }
  });
}
