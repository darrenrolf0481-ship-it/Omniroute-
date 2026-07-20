import { parseFile } from '../lib/parser';

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  const { file } = e.data;
  try {
    const text = await parseFile(file, (progress) => {
      self.postMessage({ type: 'PROGRESS', progress });
    });
    self.postMessage({ type: 'COMPLETE', text });
  } catch (err: any) {
    self.postMessage({ type: 'ERROR', error: err?.message || 'Failed to parse file.' });
  }
};
