export interface SearchMessageData {
  scanId: number;
  fileId: string;
  text: string;
  keywords: string[];
  isRegex: boolean;
}

export interface SearchResultData {
  scanId: number;
  fileId: string;
  matches: string[];
  totalMatches: number;
  isSearching: boolean;
}

self.onmessage = async (e: MessageEvent<SearchMessageData>) => {
  const { scanId, fileId, text, keywords, isRegex } = e.data;

  if (!keywords || keywords.length === 0 || !text) {
    self.postMessage({
      scanId,
      fileId,
      matches: [],
      totalMatches: 0,
      isSearching: false
    } as SearchResultData);
    return;
  }

  const lines = text.split('\n');
  const matches: string[] = [];
  let totalMatches = 0;
  const maxReturnedMatches = 5000;
  const chunkSize = 5000;
  let index = 0;

  let regex: RegExp | null = null;
  if (isRegex) {
    try {
      regex = new RegExp(keywords[0], 'i');
    } catch {
      // Invalid regex
      self.postMessage({
        scanId,
        fileId,
        matches: [],
        totalMatches: 0,
        isSearching: false
      } as SearchResultData);
      return;
    }
  }

  const lowerKeywords = !isRegex ? keywords.map(k => k.toLowerCase()) : [];

  while (index < lines.length) {
    const end = Math.min(index + chunkSize, lines.length);

    for (let i = index; i < end; i++) {
      const line = lines[i];
      if (line.trim().length === 0) continue;

      let isMatch = false;
      if (isRegex && regex) {
        isMatch = regex.test(line);
      } else {
        const lowerLine = line.toLowerCase();
        isMatch = lowerKeywords.some(kw => lowerLine.includes(kw));
      }

      if (isMatch) {
        totalMatches++;
        if (matches.length < maxReturnedMatches) {
          matches.push(line.trim());
        }
      }
    }

    index = end;

    if (index < lines.length) {
      // Post intermediate progress so match count updates live
      self.postMessage({
        scanId,
        fileId,
        matches,
        totalMatches,
        isSearching: true
      } as SearchResultData);

      await new Promise(r => setTimeout(r, 0));
    }
  }

  self.postMessage({
    scanId,
    fileId,
    matches,
    totalMatches,
    isSearching: false
  } as SearchResultData);
};
