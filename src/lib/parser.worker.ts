// Runs all file parsing off the main thread. Heavy decode/regex/string work in
// here can never freeze the UI, and if a giant file exhausts memory only this
// worker dies — the app itself stays alive and can report the failure.
import { parseFileCore } from './parserCore';

interface ParseRequest {
  id: number;
  file: File;
}

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  const { id, file } = e.data;
  try {
    const text = await parseFileCore(file, (progress) => {
      self.postMessage({ id, type: 'progress', progress });
    });
    self.postMessage({ id, type: 'done', text });
  } catch (err) {
    self.postMessage({
      id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
