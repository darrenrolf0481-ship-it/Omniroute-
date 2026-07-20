# OmniScan Converter & Keyword Scanner

OmniScan Converter is a high-performance, fully offline browser-based utility designed to inspect, convert, and scan complex and heavy data file formats (such as `.mht`, `.bin`, `.json`, `.dat`, `.csv`, `.xml`, and nested `.zip` archives) into clean, human-readable structured document formats.

---

## 🚀 Key Features

1. **Multi-Format Ingestion**: Drag-and-drop or select single files, multiple files, folders, or compressed ZIP archives containing source assets.
2. **On-the-Fly Formatting**: Isolates readable textual logs and streams data into normalized streams.
3. **Keyword & Regex Scanner**: Scans thousands of lines asynchronously utilizing a yielding event loop to highlight matching data strings on the fly.
4. **Interactive Print & Export Console**: Preview exactly what you export, format-to-format, with highlight markers preserved.
5. **Durable Architecture**: Uses a non-reactive memory store to hold raw files, shielding React's rendering state from massive memory overhead.

---

## 📥 Supported Input Formats (Parsing Logic)

The core conversion engine processes incoming files in **1MB chunks** to isolate text and eliminate formatting clutter:

*   **`.mht` / `.mhtml` (Mime HTML)**:
    *   Filters out Base64 image/binary payload lines using regular expression boundaries to prevent memory thrashing.
    *   Strips out standard MIME transport headers (e.g., `Content-Type`, `Content-Location`, boundaries).
    *   Decodes Quoted-Printable format characters (e.g., `=3D` to `=` or hex mappings).
    *   Safely extracts textual sections by isolating and removing `<style>` and `<script>` elements.
    *   Strips HTML tags to leave pure text and decodes common HTML entities (`&nbsp;`, `&lt;`, etc.).
    *   Normalizes duplicate whitespaces and carriage returns.
*   **`.bin` / `.dat` (Binary)**:
    *   Decodes chunks as raw bytes and extracts human-readable ASCII characters (printable bytes `32-126`, carriage returns, and newlines) to isolate raw system logs or hardcoded text pools.
*   **`.json`**:
    *   Decodes, formats, and structures objects with proper tabulations.
*   **`.zip` (Nested Archives)**:
    *   Uncompresses archives in-browser and feeds underlying file buffers directly to individual format handlers.
*   **`.txt` / `.csv` / `.xml`**:
    *   Ingests raw text files in streams, preserving custom layouts.

---

## 📤 Supported Export Formats

Users can export single processed files or trigger a bulk export (which bundles files into a consolidated `.zip` archive) in any of these formats:

1.  **Plain Text (`.txt`)**: Clean text logs, optionally prepend-loaded with matching keyword logs if active.
2.  **Markdown (`.md`)**: Fully formatted document summaries with match telemetry, keyword summaries, and blockquotes of hit lines.
3.  **JSON (`.json`)**: Structured export schema enclosing:
    ```json
    {
      "originalFile": "filename.mht",
      "keywords": ["error", "token"],
      "matchCount": 12,
      "matches": ["line 1 containing error...", "..."],
      "fullText": "Full parsed text..."
    }
    ```
4.  **PDF (`.pdf`)**: Formatted printable layout optimized for PDF generation or physical printing.

---

## 🛠️ Performance Optimization & Current Architecture

To handle larger files without crashing or freezing, the application employs several optimizations:

1.  **Chunked ArrayBuffer Loading**: Reads chunks of `1024 * 1024` bytes from the user-selected `File` handle using `file.slice()`, streaming them through `TextDecoder` to avoid holding a giant monolithic raw buffer in memory.
2.  **Non-Reactive Global Cache**: Full parsed strings are saved in a standard, non-reactive `Map` variable (`parsedTextCache`) rather than inside React's reactive state engine. React state variables are only updated with a **50,000-character preview slice**, protecting React's Virtual DOM from diffing massive strings.
3.  **Yielding Loops**: File parsers (`parser.ts`) and keyword match scanners (`App.tsx`) utilize a microtask-yielding mechanism (`await new Promise(r => setTimeout(r, 0))`) to periodically release control back to the browser's UI render loop, preserving CSS animations and preventing page freezes.

---

## ✅ White-Screen Crash Fix (Web Worker Parsing)

Loading large non-`.txt` files (JSON, MD, MHT, BIN) used to block the browser's main thread for seconds and spike memory to several times the file size, which crashed the renderer — the tab went white, unmounted, and reloaded back to an empty app. The following architecture changes resolve this:

1.  **Web Worker Parsing (`src/lib/parser.worker.ts`)**:
    All file parsing now runs in a background Web Worker (`src/lib/parserCore.ts` holds the shared parsing routines; `src/lib/parser.ts` is the main-thread bridge with a non-worker fallback). The UI thread never blocks during parsing, and if a truly enormous file exhausts the worker's memory, only the worker dies — the app stays alive and shows an error entry for that file instead of white-screening.
2.  **Guarded JSON Pretty-Printing**:
    `.json` files are now read in 1MB chunks like every other format. `JSON.parse` + pretty `JSON.stringify` (which can multiply memory usage several times over) only runs for files under **16MB**; larger JSON files are shown raw.
3.  **Allocation-Free Line Scanning**:
    The keyword scanner walks the document with `indexOf('\n')` instead of `split('\n')`, which previously materialized a full second copy of the document as an array. Matches are capped at **5,000** and each stored match line is truncated to **1,000 characters**, so a single multi-megabyte minified line can no longer flood React state or the DOM.
4.  **Bounded Preview & Export Rendering**:
    The print-preview modal renders at most **100,000 characters** into the DOM (downloads still contain the full document), and PDF export caps layout work at **1,000,000 characters** to keep jsPDF from freezing the tab.

Verified headroom: a 118MB single-line minified JSON now loads in ~2 seconds with the UI responsive throughout (worst main-thread stall ~100ms), keyword search over it completes in ~3 seconds, and the preview modal opens instantly.

### Possible Future Improvements:

*   **Streamed Chunk Saving**:
    Rather than joining all chunks into a giant string, save the parsed chunks as an array of smaller strings or stream them directly into IndexedDB (`localForage` or similar) to completely avoid massive string heap allocations.
*   **Virtual List Previewing**:
    Only process and highlight lines currently visible on the screen using a virtual window list (like `react-window` or custom viewport checks) rather than highlighting the entire 50,000-character string at once.
*   **Worker-Side Keyword Scanning**:
    Move the keyword scanner into the worker as well, so even the per-line `toLowerCase()`/regex work happens off the main thread.
