import React, { useState, useRef, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, FileText, Download, Search, FileType, FileJson, AlertCircle, Eye, X } from 'lucide-react';
import { cn } from './lib/utils';
import { parseFile } from './lib/parser';
import { downloadTxt, downloadMd, downloadJson, downloadPdf, downloadBatchZip } from './lib/exportUtils';
import JSZip from 'jszip';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, YAxis } from 'recharts';

interface ScannedFile {
  id: string;
  file: File;
  previewText: string; // First 50,000 characters for render preview
  detectedType: string;
  typeColor: string;
}

// Global non-reactive memory cache to prevent massive files from loading into React state
const parsedTextCache = new Map<string, string>();

// Caps that keep search results and print previews from ballooning the DOM /
// heap when scanning very large documents (a single minified-JSON "line" can be
// hundreds of megabytes on its own).
const MAX_MATCHES = 5000;
const MAX_MATCH_LENGTH = 1000;
const PREVIEW_CHAR_LIMIT = 100000;

function getFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

const getFileTypeInfo = (file: File, parsedText: string) => {
  let detectedType = '';
  if (file.name.includes('.')) {
    detectedType = file.name.split('.').pop()?.toUpperCase() || '';
  }
  
  if (!detectedType) {
    const preview = parsedText.substring(0, 150).trim();
    if (preview.startsWith('{') || preview.startsWith('[')) {
      detectedType = 'JSON';
    } else if (preview.startsWith('<')) {
      detectedType = preview.toLowerCase().includes('html') ? 'HTML' : 'XML';
    } else if (preview.toLowerCase().startsWith('id') || preview.toLowerCase().startsWith('name')) {
      detectedType = 'CSV';
    } else {
      detectedType = 'TXT';
    }
  }

  let typeColor = 'text-blue-400 border-blue-500/20 bg-blue-500/10';
  switch (detectedType) {
    case 'MHT':
    case 'MHTML':
    case 'HTML':
      typeColor = 'text-blue-400 border-blue-500/20 bg-blue-500/10';
      break;
    case 'BIN':
    case 'DAT':
      typeColor = 'text-amber-400 border-amber-500/20 bg-amber-500/10';
      break;
    case 'JSON':
      typeColor = 'text-purple-400 border-purple-500/20 bg-purple-500/10';
      break;
    case 'CSV':
    case 'XML':
      typeColor = 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10';
      break;
    default:
      typeColor = 'text-slate-400 border-slate-500/20 bg-slate-500/10';
      break;
  }
  return { detectedType: detectedType || 'FILE', typeColor };
};

function AppContent() {
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [sortOption, setSortOption] = useState<string>("default");
  const [keywords, setKeywords] = useState<string>("");
  const [useRegex, setUseRegex] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [parseProgress, setParseProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [previewFormat, setPreviewFormat] = useState<'txt' | 'md' | 'json' | 'pdf' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const activeFile = activeFileId ? files.find(f => f.id === activeFileId) || null : null;

  const sortedFiles = useMemo(() => {
    if (sortOption === "default") return files;
    const sorted = [...files];
    if (sortOption === "name-asc") sorted.sort((a, b) => a.file.name.localeCompare(b.file.name));
    else if (sortOption === "name-desc") sorted.sort((a, b) => b.file.name.localeCompare(a.file.name));
    else if (sortOption === "size-asc") sorted.sort((a, b) => a.file.size - b.file.size);
    else if (sortOption === "size-desc") sorted.sort((a, b) => b.file.size - a.file.size);
    else if (sortOption === "type-asc") sorted.sort((a, b) => {
      const extA = a.file.name.split('.').pop()?.toLowerCase() || '';
      const extB = b.file.name.split('.').pop()?.toLowerCase() || '';
      return extA.localeCompare(extB) || a.file.name.localeCompare(b.file.name);
    });
    else if (sortOption === "type-desc") sorted.sort((a, b) => {
      const extA = a.file.name.split('.').pop()?.toLowerCase() || '';
      const extB = b.file.name.split('.').pop()?.toLowerCase() || '';
      return extB.localeCompare(extA) || b.file.name.localeCompare(a.file.name);
    });
    return sorted;
  }, [files, sortOption]);

  const activeKeywords = useMemo(() => {
    if (useRegex) {
      if (keywords.trim().length === 0) return [];
      return [keywords.trim()];
    }
    return keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }, [keywords, useRegex]);



  const handleCopyText = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError("Failed to copy text to clipboard.");
    }
  };

  const getPreviewFormattedContent = (format: 'txt' | 'md' | 'json' | 'pdf' | null) => {
    if (!format || !activeFile) return "";
    const f = activeFile;
    const fullText = parsedTextCache.get(f.id) || f.previewText;
    const fileMatches = searchResults[f.id]?.matches || [];
    let contentToExport = fullText;

    if (activeKeywords.length > 0 && fileMatches.length > 0) {
      contentToExport = `--- SCAN RESULTS ---\nKeywords: ${activeKeywords.join(', ')}\nMatches found: ${fileMatches.length}\n\n[MATCHES]\n${fileMatches.join('\n\n')}\n\n[FULL TEXT]\n${fullText}`;
    }

    if (format === 'json') {
      const jsonContent = {
        originalFile: f.file.name,
        keywords: activeKeywords,
        matchCount: fileMatches.length,
        matches: fileMatches,
        fullText: fullText
      };
      return JSON.stringify(jsonContent, null, 2);
    }

    if (format === 'md') {
      let mdContent = contentToExport;
      if (activeKeywords.length > 0 && fileMatches.length > 0) {
        mdContent = `# Scan Results\n**Keywords:** ${activeKeywords.join(', ')}\n**Matches found:** ${fileMatches.length}\n\n## Matches\n\n${fileMatches.map(m => `> ${m}`).join('\n\n')}\n\n## Full Text\n\n\`\`\`\n${fullText}\n\`\`\``;
      }
      return mdContent;
    }

    return contentToExport;
  };

  // Asynchronous Search States
  const [searchResults, setSearchResults] = useState<Record<string, { matches: string[]; isSearching: boolean }>>({});
  const activeScansRef = useRef<Record<string, number>>({});

  const processFiles = async (newFiles: File[]) => {
    setIsProcessing(true);
    setError(null);
    
    // Yield to the event loop so the browser can render the loading spinner
    await new Promise(r => setTimeout(r, 50));

    try {
      const allFiles: File[] = [];
      for (const file of newFiles) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          try {
            const zip = new JSZip();
            await zip.loadAsync(file);
            const zipFiles = Object.values(zip.files).filter(f => !f.dir);
            for (const zf of zipFiles) {
              const blob = await zf.async('blob');
              const extractedFile = new File([blob], zf.name, { type: blob.type || 'application/octet-stream' });
              allFiles.push(extractedFile);
            }
          } catch (e) {
            setError(`Failed to extract ${file.name}`);
          }
        } else {
          allFiles.push(file);
        }
      }

      const parsedFiles: ScannedFile[] = [];
      for (const file of allFiles) {
        try {
          setParseProgress(0);
          const text = await parseFile(file, (p) => setParseProgress(p));
          const fileId = getFileId(file);
          parsedTextCache.set(fileId, text);
          
          const previewText = text.substring(0, 50000);
          const { detectedType, typeColor } = getFileTypeInfo(file, text);
          
          parsedFiles.push({
            id: fileId,
            file,
            previewText,
            detectedType,
            typeColor
          });
        } catch (parseErr) {
          const fileId = getFileId(file);
          const message = parseErr instanceof Error ? parseErr.message : 'Failed to parse file.';
          parsedFiles.push({
            id: fileId,
            file,
            previewText: `[ERROR] ${message}`,
            detectedType: 'ERR',
            typeColor: 'text-red-400 border-red-500/20 bg-red-500/10'
          });
        }
      }
      
      setFiles((prev) => [...prev, ...parsedFiles]);
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        parsedFiles.forEach(f => next.add(f.id));
        return next;
      });
      setActiveFileId((prev) => (!prev && parsedFiles.length > 0 ? parsedFiles[0].id : prev));
    } catch (err) {
      setError("An error occurred while processing files.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
    // reset input so same files can be selected again if needed
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Run Async scanning in chunks to prevent UI thread lock on large files
  const runAsyncSearch = async (fileId: string, fullText: string, keywordsList: string[], isRegex: boolean) => {
    if (keywordsList.length === 0) {
      setSearchResults(prev => ({ ...prev, [fileId]: { matches: [], isSearching: false } }));
      return;
    }

    setSearchResults(prev => ({
      ...prev,
      [fileId]: { matches: prev[fileId]?.matches || [], isSearching: true }
    }));

    const scanId = (activeScansRef.current[fileId] || 0) + 1;
    activeScansRef.current[fileId] = scanId;

    // Walk the text line-by-line via indexOf instead of split('\n'), which would
    // materialize a full second copy of a potentially huge document.
    const matches: string[] = [];
    const linesPerTick = 2000;
    let pos = 0;

    let regex: RegExp | null = null;
    if (isRegex) {
      try {
        regex = new RegExp(keywordsList[0], 'i');
      } catch (e) {
        regex = null; // invalid regex
      }
    }
    const lowerKeywords = keywordsList.map(kw => kw.toLowerCase());

    while (pos < fullText.length && matches.length < MAX_MATCHES) {
      if (activeScansRef.current[fileId] !== scanId) {
        return; // Search cancelled or outdated
      }

      for (let n = 0; n < linesPerTick && pos < fullText.length; n++) {
        let newline = fullText.indexOf('\n', pos);
        if (newline === -1) newline = fullText.length;
        const line = fullText.slice(pos, newline).trim();
        pos = newline + 1;

        if (line.length === 0) continue;

        let isMatch = false;
        if (isRegex) {
          isMatch = regex !== null && regex.test(line);
        } else {
          const lowerLine = line.toLowerCase();
          isMatch = lowerKeywords.some(kw => lowerLine.includes(kw));
        }
        if (isMatch) {
          matches.push(line.length > MAX_MATCH_LENGTH ? `${line.slice(0, MAX_MATCH_LENGTH)} […]` : line);
          if (matches.length >= MAX_MATCHES) break;
        }
      }

      // Yield execution to the browser thread to maintain 60fps
      await new Promise(r => setTimeout(r, 0));
    }

    if (activeScansRef.current[fileId] !== scanId) return;
    setSearchResults(prev => ({
      ...prev,
      [fileId]: { matches, isSearching: false }
    }));
  };

  // Trigger search updates reactively
  useEffect(() => {
    if (files.length === 0) return;

    files.forEach(f => {
      const fullText = parsedTextCache.get(f.id) || f.previewText;
      runAsyncSearch(f.id, fullText, activeKeywords, useRegex);
    });

    return () => {
      // Cancel active searches on query changes
      files.forEach(f => {
        activeScansRef.current[f.id] = (activeScansRef.current[f.id] || 0) + 1;
      });
    };
  }, [keywords, useRegex, files.map(f => f.id).join(',')]);

  const chartData = useMemo(() => {
    return files
      .map(f => {
        const matchCount = searchResults[f.id]?.matches?.length || 0;
        return {
          name: f.file.name.length > 12 ? f.file.name.substring(0, 12) + '...' : f.file.name,
          fullName: f.file.name,
          matches: matchCount
        };
      })
      .filter(d => d.matches > 0)
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 5); // top 5
  }, [files, searchResults]);

  const activeFileMatches = activeFile ? (searchResults[activeFile.id]?.matches || []) : [];
  const activeFileSearching = activeFile ? (searchResults[activeFile.id]?.isSearching || false) : false;

  const handleExport = async (format: 'txt' | 'md' | 'json' | 'pdf') => {
    const filesToExport = sortedFiles.filter(f => selectedFileIds.has(f.id));
    if (filesToExport.length === 0) return;
    
    if (filesToExport.length === 1) {
      // Single file export
      const f = filesToExport[0];
      const baseName = f.file.name.replace(/\.[^/.]+$/, "");
      const outName = `${baseName}_scanned`;
      const fullText = parsedTextCache.get(f.id) || f.previewText;
      const fileMatches = searchResults[f.id]?.matches || [];
      let contentToExport = fullText;
      
      if (activeKeywords.length > 0 && fileMatches.length > 0) {
        contentToExport = `--- SCAN RESULTS ---\nKeywords: ${activeKeywords.join(', ')}\nMatches found: ${fileMatches.length}\n\n[MATCHES]\n${fileMatches.join('\n\n')}\n\n[FULL TEXT]\n${fullText}`;
      }

      if (format === 'txt') {
        downloadTxt(contentToExport, outName);
      } else if (format === 'md') {
        let mdContent = contentToExport;
        if (activeKeywords.length > 0 && fileMatches.length > 0) {
          mdContent = `# Scan Results\n**Keywords:** ${activeKeywords.join(', ')}\n**Matches found:** ${fileMatches.length}\n\n## Matches\n\n${fileMatches.map(m => `> ${m}`).join('\n\n')}\n\n## Full Text\n\n\`\`\`\n${fullText}\n\`\`\``;
        }
        downloadMd(mdContent, outName);
      } else if (format === 'json') {
        downloadJson({
          originalFile: f.file.name,
          keywords: activeKeywords,
          matchCount: fileMatches.length,
          matches: fileMatches,
          fullText: fullText
        }, outName);
      } else if (format === 'pdf') {
        downloadPdf(contentToExport, outName);
      }
    } else {
      // Batch export via Zip
      const exportItems: { content: string | object, filename: string, type: 'txt' | 'md' | 'json' | 'pdf' }[] = [];
      for (const f of filesToExport) {
        const baseName = f.file.name.replace(/\.[^/.]+$/, "");
        const fullText = parsedTextCache.get(f.id) || f.previewText;
        const fileMatches = searchResults[f.id]?.matches || [];
        let contentToExport = fullText;

        if (activeKeywords.length > 0 && fileMatches.length > 0) {
          contentToExport = `--- SCAN RESULTS ---\nKeywords: ${activeKeywords.join(', ')}\nMatches found: ${fileMatches.length}\n\n[MATCHES]\n${fileMatches.join('\n\n')}\n\n[FULL TEXT]\n${fullText}`;
        }
        
        if (format === 'txt') {
          exportItems.push({ content: contentToExport, filename: baseName, type: 'txt' });
        } else if (format === 'md') {
          let mdContent = contentToExport;
          if (activeKeywords.length > 0 && fileMatches.length > 0) {
            mdContent = `# Scan Results\n**Keywords:** ${activeKeywords.join(', ')}\n**Matches found:** ${fileMatches.length}\n\n## Matches\n\n${fileMatches.map(m => `> ${m}`).join('\n\n')}\n\n## Full Text\n\n\`\`\`\n${fullText}\n\`\`\``;
          }
          exportItems.push({ content: mdContent, filename: baseName, type: 'md' });
        } else if (format === 'json') {
          exportItems.push({
            content: {
              originalFile: f.file.name,
              keywords: activeKeywords,
              matchCount: fileMatches.length,
              matches: fileMatches,
              fullText: fullText
            },
            filename: baseName,
            type: 'json'
          });
        } else if (format === 'pdf') {
          exportItems.push({ content: contentToExport, filename: baseName, type: 'pdf' });
        }
      }
      setIsProcessing(true);
      try {
        await downloadBatchZip(exportItems, `BatchExport_${format.toUpperCase()}.zip`);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const HighlightedText = ({ text, keywords, isRegex }: { text: string; keywords: string[]; isRegex?: boolean }) => {
    if (!text) return null;
    if (keywords.length === 0) return <span>{text}</span>;

    try {
      if (isRegex) {
        const regex = new RegExp(keywords[0], 'gi');
        const matches = [];
        for (const match of text.matchAll(regex)) {
           matches.push(match);
           if (matches.length > 100) break;
        }
        
        if (matches.length === 0) return <span>{text}</span>;
        
        const nodes = [];
        let lastIndex = 0;
        matches.forEach((match, i) => {
          if (match.index !== undefined) {
             nodes.push(<span key={`text-${i}`}>{text.substring(lastIndex, match.index)}</span>);
             nodes.push(
               <mark key={`mark-${i}`} className="bg-blue-500/30 text-blue-400 font-medium px-1 rounded-sm ring-1 ring-blue-500/50">
                 {match[0]}
               </mark>
             );
             lastIndex = match.index + match[0].length;
          }
        });
        nodes.push(<span key="text-end">{text.substring(lastIndex)}</span>);
        if (matches.length > 100) {
            nodes.push(<span key="warning" className="text-[10px] text-amber-500 ml-2">[Highlighting limited to 100 matches]</span>);
        }
        return <span>{nodes}</span>;
      } else {
        const regex = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
        
        let parts = text.split(regex);
        let isTruncated = false;
        
        // Safety limit to prevent React from trying to render 10,000+ nodes and crashing/freezing
        if (parts.length > 2000) {
           parts = parts.slice(0, 2000);
           isTruncated = true;
        }
        
        return (
          <span>
            {parts.map((part, i) => {
              if (part === undefined || part === null) return null;
              const isMatch = keywords.some(k => k.toLowerCase() === part.toLowerCase());
              return isMatch ? (
                <mark key={i} className="bg-blue-500/30 text-blue-400 font-medium px-1 rounded-sm ring-1 ring-blue-500/50">
                  {part}
                </mark>
              ) : (
                <span key={i}>{part}</span>
              );
            })}
            {isTruncated && <span className="text-[10px] text-amber-500 ml-2">[Highlighting limited for performance]</span>}
          </span>
        );
      }
    } catch (e) {
      return <span>{text}</span>;
    }
  };

  const renderPreviewContent = () => {
    const f = activeFile;
    if (!f) return <div className="text-white/50">No file selected.</div>;

    const cachedText = parsedTextCache.get(f.id) || f.previewText;
    // Only render a slice into the DOM — the downloaded file still gets the full text.
    const isTruncated = cachedText.length > PREVIEW_CHAR_LIMIT;
    const fullText = isTruncated
      ? `${cachedText.slice(0, PREVIEW_CHAR_LIMIT)}\n\n[... Preview truncated for performance — the downloaded file will contain the full document.]`
      : cachedText;
    const fileMatches = searchResults[f.id]?.matches || [];
    const previewMatches = fileMatches.slice(0, 200);
    let contentToExport = fullText;

    if (activeKeywords.length > 0 && fileMatches.length > 0) {
      contentToExport = `--- SCAN RESULTS ---\nKeywords: ${activeKeywords.join(', ')}\nMatches found: ${fileMatches.length}\n\n[MATCHES]\n${previewMatches.join('\n\n')}\n\n[FULL TEXT]\n${fullText}`;
    }

    if (previewFormat === 'json') {
      const jsonContent = {
        originalFile: f.file.name,
        keywords: activeKeywords,
        matchCount: fileMatches.length,
        matches: previewMatches,
        fullText: fullText
      };
      return <pre className="font-mono text-xs whitespace-pre-wrap text-slate-800">{JSON.stringify(jsonContent, null, 2)}</pre>;
    }

    if (previewFormat === 'md') {
      let mdContent = contentToExport;
      if (activeKeywords.length > 0 && fileMatches.length > 0) {
        mdContent = `# Scan Results\n**Keywords:** ${activeKeywords.join(', ')}\n**Matches found:** ${fileMatches.length}\n\n## Matches\n\n${previewMatches.map(m => `> ${m}`).join('\n\n')}\n\n## Full Text\n\n\`\`\`\n${fullText}\n\`\`\``;
      }
      return <pre className="font-mono text-xs whitespace-pre-wrap text-slate-800">{mdContent}</pre>;
    }

    // TXT and PDF
    return (
      <div className={previewFormat === 'pdf' ? "max-w-[180mm] mx-auto bg-white p-8 shadow-sm border border-slate-200" : ""}>
        <pre className={cn("font-mono text-xs whitespace-pre-wrap", previewFormat === 'pdf' ? "text-black font-sans leading-relaxed" : "text-slate-800")}>
          {contentToExport}
        </pre>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-slate-300 font-sans selection:bg-blue-500/30">
      <AnimatePresence>
        {previewFormat && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0e1014] border border-white/10 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="px-6 py-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-400" /> Print Preview: {previewFormat.toUpperCase()}
                </h2>
                <button onClick={() => setPreviewFormat(null)} className="text-white/40 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 bg-slate-100 text-black">
                 {renderPreviewContent()}
              </div>
              <div className="p-4 border-t border-white/5 bg-[#0e1014] flex justify-end gap-3">
                <button onClick={() => setPreviewFormat(null)} className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors">Cancel</button>
                <button onClick={() => { handleExport(previewFormat); setPreviewFormat(null); }} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium shadow-lg shadow-blue-500/20">
                  Download {previewFormat.toUpperCase()}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <header className="h-16 flex items-center justify-between px-6 border-b border-white/10 bg-white/[0.03] backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center">
            <FileType className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">OmniScan <span className="text-blue-400 font-normal">Converter</span></h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Controls */}
        <div className="lg:col-span-4 space-y-6">

          {files.length > 0 && (
            <section className="bg-white/[0.02] p-6 rounded-xl border border-white/5">
              <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4 block">Dashboard Summary</h2>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-black/40 p-3 rounded-lg border border-white/5 text-center flex flex-col items-center justify-center">
                  <div className="text-xl font-bold text-blue-400">{files.length}</div>
                  <div className="text-[9px] text-white/40 uppercase tracking-wider mt-1">Files</div>
                </div>
                <div className="bg-black/40 p-3 rounded-lg border border-white/5 text-center flex flex-col items-center justify-center">
                  <div className="text-xl font-bold text-blue-400">
                    {(files.reduce((acc, f) => acc + f.file.size, 0) / (1024 * 1024)).toFixed(1)}
                  </div>
                  <div className="text-[9px] text-white/40 uppercase tracking-wider mt-1">MB Size</div>
                </div>
                <div className="bg-black/40 p-3 rounded-lg border border-white/5 text-center flex flex-col items-center justify-center">
                  <div className="text-xl font-bold text-blue-400">
                    {files.reduce((acc, f) => acc + (searchResults[f.id]?.matches?.length || 0), 0)}
                  </div>
                  <div className="text-[9px] text-white/40 uppercase tracking-wider mt-1">Matches</div>
                </div>
              </div>

              {chartData.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-[9px] uppercase tracking-widest text-white/40 font-bold mb-3">Top Files by Matches</h3>
                  <div className="h-40 w-full bg-black/20 rounded-lg p-2 border border-white/5">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <XAxis 
                          dataKey="name" 
                          tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} 
                          axisLine={false} 
                          tickLine={false} 
                        />
                        <YAxis 
                          tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} 
                          axisLine={false} 
                          tickLine={false} 
                          width={40}
                        />
                        <Tooltip 
                          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                          contentStyle={{ backgroundColor: '#0e1014', borderColor: 'rgba(255,255,255,0.1)', fontSize: '12px', borderRadius: '8px' }}
                          itemStyle={{ color: '#60a5fa' }}
                        />
                        <Bar dataKey="matches" radius={[4, 4, 0, 0]}>
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === 0 ? '#3b82f6' : '#1e3a8a'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="bg-white/[0.02] p-6 rounded-xl border border-white/5">
            <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4 block">Source Files</h2>
            <div 
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500/50 hover:bg-white/[0.04] transition-colors"
            >
              <input 
                type="file" 
                multiple
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
              />
              <Upload className="w-8 h-8 mx-auto mb-3 text-white/20" />
              <div>
                <p className="text-xs text-white/60">Drag & drop files or folder</p>
                <p className="text-[10px] text-white/40 mt-1">Supports MHT, BIN, JSON, DAT, CSV, XML, ZIP, etc.</p>
              </div>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}
            
            {files.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Queue ({files.length})</h2>
                    <select 
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value)}
                      className="bg-transparent border border-white/10 text-white/60 text-[10px] rounded px-1 py-0.5 outline-none cursor-pointer hover:border-white/20"
                    >
                      <option value="default" className="bg-[#0e1014]">Sort: Default</option>
                      <option value="name-asc" className="bg-[#0e1014]">Name (A-Z)</option>
                      <option value="name-desc" className="bg-[#0e1014]">Name (Z-A)</option>
                      <option value="size-asc" className="bg-[#0e1014]">Size (Smallest)</option>
                      <option value="size-desc" className="bg-[#0e1014]">Size (Largest)</option>
                      <option value="type-asc" className="bg-[#0e1014]">Type (A-Z)</option>
                      <option value="type-desc" className="bg-[#0e1014]">Type (Z-A)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        if (selectedFileIds.size === files.length) {
                          setSelectedFileIds(new Set());
                        } else {
                          setSelectedFileIds(new Set(files.map(f => f.id)));
                        }
                      }} 
                      className="text-[10px] text-blue-400 hover:text-blue-300"
                    >
                      {selectedFileIds.size === files.length ? "Deselect All" : "Select All"}
                    </button>
                    <span className="text-white/20">|</span>
                    <button onClick={() => { setFiles([]); setActiveFileId(null); setSelectedFileIds(new Set()); parsedTextCache.clear(); }} className="text-[10px] text-red-400 hover:text-red-300">Clear All</button>
                  </div>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {sortedFiles.map((f, idx) => {
                    const isSearching = searchResults[f.id]?.isSearching || false;
                    const matchCount = searchResults[f.id]?.matches?.length || 0;
                    const isSelected = selectedFileIds.has(f.id);
                    return (
                      <div 
                        key={f.id} 
                        className={cn(
                          "p-3 rounded-lg border flex items-center gap-3 transition-colors",
                          activeFileId === f.id 
                            ? "bg-blue-500/10 border-blue-500/20" 
                            : "bg-white/[0.03] border-white/5 hover:border-white/10"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const newSet = new Set(selectedFileIds);
                            if (e.target.checked) {
                              newSet.add(f.id);
                            } else {
                              newSet.delete(f.id);
                            }
                            setSelectedFileIds(newSet);
                          }}
                          className="w-4 h-4 cursor-pointer accent-blue-500 bg-white/5 border-white/10 rounded shrink-0"
                        />
                        <div 
                          className="flex-1 flex items-center gap-3 cursor-pointer overflow-hidden"
                          onClick={() => setActiveFileId(f.id)}
                        >
                          <div className={cn("text-[10px] font-bold font-mono px-2 py-1 rounded w-11 text-center shrink-0 border", f.typeColor)}>
                            {f.detectedType?.substring(0, 4) || 'FILE'}
                          </div>
                          <div className="flex-1 truncate">
                            <div className="text-xs text-white truncate flex items-center justify-between gap-2" title={f.file.name}>
                              <span className="truncate">{f.file.name}</span>
                              {isSearching ? (
                                <div className="w-3.5 h-3.5 border border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
                              ) : activeKeywords.length > 0 && matchCount > 0 ? (
                                <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded shrink-0">{matchCount}</span>
                              ) : null}
                            </div>
                            <div className="text-[10px] text-white/40">{(f.file.size / 1024).toFixed(1)} KB</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="bg-white/[0.02] p-6 rounded-xl border border-white/5">
            <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4 block">Keyword Scanner</h2>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-3.5 text-white/40" />
              <input 
                type="text" 
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder={useRegex ? "Enter regular expression (e.g. \\btoken\\b)..." : "Enter keywords to find (e.g. error, token)..."}
                className="w-full pl-11 pr-24 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 transition-colors text-sm text-white placeholder-white/30"
              />
              <div className="absolute right-3 top-2.5 flex gap-1">
                <button 
                  onClick={() => setUseRegex(!useRegex)}
                  className={cn(
                    "text-[10px] px-2 py-1 rounded transition-colors",
                    useRegex ? "bg-blue-500/20 text-blue-400" : "bg-white/10 text-white/40 hover:text-white/80"
                  )}
                >
                  REGEX
                </button>
              </div>
            </div>
            {activeKeywords.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {activeKeywords.map((kw, idx) => (
                  <span key={idx} className="px-3 py-1 bg-white/10 border border-white/10 rounded-full text-[11px] flex items-center gap-2 text-white">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white/[0.02] p-6 rounded-xl border border-white/5">
            <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4 block">
              {selectedFileIds.size > 1 ? `Batch Export (${selectedFileIds.size})` : 'Export Format'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative group flex flex-col">
                <button onClick={() => handleExport('txt')} disabled={selectedFileIds.size === 0} className="w-full flex-1 py-4 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1">
                  <FileText className="w-5 h-5 mb-1 opacity-70" />
                  <span className="text-sm font-bold">TXT</span>
                </button>
                <button onClick={() => setPreviewFormat('txt')} disabled={selectedFileIds.size === 0} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-blue-500/20 text-white/40 hover:text-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:hidden" title="Print Preview">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              <div className="relative group flex flex-col">
                <button onClick={() => handleExport('md')} disabled={selectedFileIds.size === 0} className="w-full flex-1 py-4 rounded-xl border border-blue-500/50 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1 ring-1 ring-blue-500/20">
                  <FileText className="w-5 h-5 mb-1 opacity-90" />
                  <span className="text-sm font-bold">Markdown</span>
                </button>
                <button onClick={() => setPreviewFormat('md')} disabled={selectedFileIds.size === 0} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-blue-500/20 text-white/40 hover:text-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:hidden" title="Print Preview">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              <div className="relative group flex flex-col">
                <button onClick={() => handleExport('json')} disabled={selectedFileIds.size === 0} className="w-full flex-1 py-4 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1">
                  <FileJson className="w-5 h-5 mb-1 opacity-70" />
                  <span className="text-sm font-bold">JSON</span>
                </button>
                <button onClick={() => setPreviewFormat('json')} disabled={selectedFileIds.size === 0} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-blue-500/20 text-white/40 hover:text-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:hidden" title="Print Preview">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              <div className="relative group flex flex-col">
                <button onClick={() => handleExport('pdf')} disabled={selectedFileIds.size === 0} className="w-full flex-1 py-4 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1">
                  <Download className="w-5 h-5 mb-1 opacity-70" />
                  <span className="text-sm font-bold">PDF</span>
                </button>
                <button onClick={() => setPreviewFormat('pdf')} disabled={selectedFileIds.size === 0} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-blue-500/20 text-white/40 hover:text-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:hidden" title="Print Preview">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-8">
          <section className="bg-black/40 rounded-xl border border-white/5 h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 bg-[#0e1014]/50 flex items-center justify-between">
              <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                Live Inspection Console 
                {activeFileSearching ? (
                  <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin ml-2" />
                ) : activeKeywords.length > 0 && activeFileMatches.length > 0 ? (
                  <span className="text-blue-400 ml-2 border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 rounded">
                    ({activeFileMatches.length} matches)
                  </span>
                ) : null}
              </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-transparent font-mono text-[13px] text-white/80 leading-relaxed whitespace-pre-wrap">
              <AnimatePresence mode="wait">
                {isProcessing ? (
                  <motion.div 
                    key="processing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center h-full text-white/40 space-y-4"
                  >
                    <div className="relative flex items-center justify-center">
                      <div className="w-12 h-12 border-4 border-white/5 border-t-blue-500 rounded-full animate-spin" />
                      <span className="absolute text-[10px] font-bold text-blue-400 font-mono">{parseProgress}%</span>
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-xs text-white/80 font-semibold">[SYSTEM] Parsing & converting source chunks...</p>
                      <p className="text-[10px] text-white/40">Keep browser tab active • {parseProgress}% complete</p>
                    </div>
                  </motion.div>
                ) : !activeFile ? (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center h-full text-white/20"
                  >
                    <FileType className="w-12 h-12 mb-3 text-white/10" />
                    <p>Awaiting source file...</p>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="content"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {activeKeywords.length > 0 && activeFileMatches.length > 0 && (
                      <div className="mb-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                        <h3 className="font-bold text-xs text-blue-400 mb-3 uppercase tracking-widest flex items-center gap-2">
                          [KEYWORD MATCHES] ({activeFileMatches.length})
                          {activeFileSearching && <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />}
                        </h3>
                        <ul className="space-y-2 max-h-64 overflow-y-auto pr-2">
                          {activeFileMatches.slice(0, 50).map((match, idx) => (
                            <li key={idx} className="p-3 bg-black/40 rounded-lg text-xs border border-white/5 text-white/60">
                              <HighlightedText text={match} keywords={activeKeywords} isRegex={useRegex} />
                            </li>
                          ))}
                          {activeFileMatches.length > 50 && (
                            <li className="text-center text-blue-400/60 text-xs mt-2">
                              + {activeFileMatches.length - 50} more hits...
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                    
                    <div className="opacity-70 hover:opacity-100 transition-opacity">
                      {activeFile.previewText.length > 20000 ? (
                        <>
                          <HighlightedText text={activeFile.previewText.substring(0, 20000)} keywords={activeKeywords} isRegex={useRegex} />
                          <div className="mt-4 pt-4 text-center border-t border-white/10 text-white/40 text-xs">
                            [SYSTEM] Output truncated for performance. Full document preserved in memory.
                          </div>
                        </>
                      ) : (
                        <HighlightedText text={activeFile.previewText} keywords={activeKeywords} isRegex={useRegex} />
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Unknown error";
      try {
        errorMessage = this.state.error instanceof Error ? this.state.error.stack || this.state.error.message : String(this.state.error);
      } catch(e) {}
      
      return (
        <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-8">
          <div className="max-w-xl w-full bg-red-500/10 border border-red-500/20 p-8 rounded-2xl text-center">
            <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-xl font-bold text-white mb-4">A rendering error occurred</h1>
            <p className="text-red-400 text-sm mb-6 font-mono whitespace-pre-wrap text-left break-all bg-black/40 p-4 rounded-lg overflow-x-auto">
              {errorMessage}
            </p>
            <button 
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-6 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
