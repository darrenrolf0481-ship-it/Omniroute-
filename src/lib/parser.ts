export async function parseFile(file: File, onProgress?: (p: number) => void): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  
  if (ext === 'json') {
    return parseJson(file);
  }
  if (ext === 'bin' || ext === 'dat') {
    return parseBin(file, onProgress);
  }
  if (ext === 'mht' || ext === 'mhtml') {
    return parseMht(file, onProgress);
  }

  // Fallback for general text or unknown types
  return parseTxt(file, onProgress);
}

async function parseJson(file: File): Promise<string> {
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return text; // Return raw if it's invalid JSON
  }
}

async function parseBin(file: File, onProgress?: (p: number) => void): Promise<string> {
  const chunkSize = 1024 * 1024; // 1MB chunks
  const totalSize = file.size;
  let offset = 0;
  const chunks: string[] = [];
  const textDecoder = new TextDecoder('ascii');

  while (offset < totalSize) {
    const end = Math.min(offset + chunkSize, totalSize);
    const slice = file.slice(offset, end);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Fast pre-allocated array extraction
    const outBytes = new Uint8Array(bytes.length);
    let outIdx = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if ((b >= 32 && b <= 126) || b === 10 || b === 13) {
        outBytes[outIdx++] = b;
      }
    }

    chunks.push(textDecoder.decode(outBytes.subarray(0, outIdx)));
    
    offset = end;
    if (onProgress) onProgress(Math.round((offset / totalSize) * 100));
    
    // Yield to the event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return chunks.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function stripTag(text: string, tag: string) {
  const lowerText = text.toLowerCase();
  let result = '';
  let i = 0;
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  while (i < text.length) {
    const start = lowerText.indexOf(openTag, i);
    if (start === -1) {
      result += text.slice(i);
      break;
    }
    result += text.slice(i, start);
    const end = lowerText.indexOf(closeTag, start);
    if (end === -1) {
      result += text.slice(start);
      break;
    }
    i = end + closeTag.length;
  }
  return result;
}

async function parseMht(file: File, onProgress?: (p: number) => void): Promise<string> {
  const chunkSize = 1024 * 1024; // 1MB chunks
  const totalSize = file.size;
  let offset = 0;
  const chunks: string[] = [];
  let carryOver = "";
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  
  const base64Regex = /^[A-Za-z0-9+/]{70,80}={0,2}\r?$/;

  while (offset < totalSize) {
    const end = Math.min(offset + chunkSize, totalSize);
    const slice = file.slice(offset, end);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    let textChunk = decoder.decode(bytes, { stream: offset + chunkSize < totalSize });
    textChunk = carryOver + textChunk;

    if (offset + chunkSize < totalSize) {
      const lastNewline = textChunk.lastIndexOf('\n');
      if (lastNewline !== -1) {
        carryOver = textChunk.slice(lastNewline + 1);
        textChunk = textChunk.slice(0, lastNewline);
      } else {
        carryOver = "";
      }
    } else {
      carryOver = "";
    }

    // Process this chunk's lines
    const lines = textChunk.split('\n');
    const filteredLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 1. Remove base64 image data blocks
      if (line.length >= 70 && line.length <= 82 && base64Regex.test(line)) {
        continue;
      }
      
      // 2. Remove standard MIME headers
      if (/^(Content-Type|Content-Transfer-Encoding|Content-Location|Date|MIME-Version):.*$/i.test(line)) {
        continue;
      }
      if (/^------=_NextPart_/i.test(line)) {
        continue;
      }
      
      filteredLines.push(line);
    }
    
    let processedChunk = filteredLines.join('\n');
    
    // 3. Decode Quoted-Printable
    processedChunk = processedChunk.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return match;
      }
    });
    processedChunk = processedChunk.replace(/=\r?\n/g, ''); // Soft line breaks

    // 4. Strip HTML tags safely
    processedChunk = stripTag(processedChunk, 'style');
    processedChunk = stripTag(processedChunk, 'script');
    processedChunk = processedChunk.replace(/<[^>]+>/g, ' ');

    // 5. Decode basic HTML entities per chunk to prevent giant global operations
    processedChunk = processedChunk.replace(/&nbsp;/gi, ' ');
    processedChunk = processedChunk.replace(/&lt;/gi, '<');
    processedChunk = processedChunk.replace(/&gt;/gi, '>');
    processedChunk = processedChunk.replace(/&amp;/gi, '&');
    processedChunk = processedChunk.replace(/&quot;/gi, '"');

    // 6. Clean up excessive whitespace per chunk to prevent giant global operations
    processedChunk = processedChunk.replace(/[ \t]{2,}/g, ' ');
    processedChunk = processedChunk.replace(/\n\s*\n/g, '\n\n');

    chunks.push(processedChunk);

    offset = end;
    if (onProgress) onProgress(Math.round((offset / totalSize) * 100));

    // Yield to the event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return chunks.join('').trim();
}

async function parseTxt(file: File, onProgress?: (p: number) => void): Promise<string> {
  const chunkSize = 1024 * 1024; // 1MB chunks
  const totalSize = file.size;
  let offset = 0;
  const chunks: string[] = [];
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

  while (offset < totalSize) {
    const end = Math.min(offset + chunkSize, totalSize);
    const slice = file.slice(offset, end);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    const textChunk = decoder.decode(bytes, { stream: offset + chunkSize < totalSize });
    chunks.push(textChunk);

    offset = end;
    if (onProgress) onProgress(Math.round((offset / totalSize) * 100));

    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return chunks.join('');
}
