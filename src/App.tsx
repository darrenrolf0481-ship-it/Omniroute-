import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Upload, FileText, Download, Search, FileType, FileJson, AlertCircle, Eye, X, Copy, Check, Trash2 } from 'lucide-react';
import { cn } from './lib/utils';
import { parseFile } from './lib/parser';
import { downloadTxt, downloadMd, downloadJson, downloadPdf, downloadBatchZip } from './lib/exportUtils';
import { VirtualizedText, HighlightedLine } from './components/VirtualizedText';
import { getCachedText, setCachedText, deleteCachedText, clearAllCachedText } from './lib/db';
import type { SearchResultData } from './workers/search.worker';
import JSZip from 'jszip';

interface ScannedFile {
  id: string;
  file: File;
  previewText: string;
  detectedType: string;
  typeColor: string;
}

// Memory cache for active session fast access
const parsedTextCache = new Map<string, string>();

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

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [keywords, setKeywords] = useState<string>("");
  const [queueSearch, setQueueSearch] = useState<string>("");
  const [sortOption, setSortOption] = useState<string>("default");
  const [useRegex, setUseRegex] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [parseProgress, setParseProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [previewFormat, setPreviewFormat] = useState<'txt' | 'md' | 'json' | 'pdf' | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Asynchronous Search States
  const [searchResults, setSearchResults] = useState<Record<string, { matches: string[]; totalMatches: number; isSearching: boolean }>>({});
  const activeScansRef = useRef<Record<string, number>>({});
  const searchWorkerRef = useRef<Worker | null>(null);

  // Initialize search worker
  useEffect(() => {
    try {
      const worker = new Worker(new URL('./workers/search.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<SearchResultData>) => {
        const { scanId, fileId, matches, totalMatches, isSearching } = e.data;
        if (activeScansRef.current[fileId] === scanId) {
          setSearchResults(prev => ({
            ...prev,
            [fileId]: { matches, totalMatches, isSearching }
          }));
        }
      };
      searchWorkerRef.current = worker;
    } catch (err) {
      console.warn("Search worker initialization failed", err);
    }

    return () => {
      searchWorkerRef.current?.terminate();
    };
  }, []);

  const processFiles = async (newFiles: File[]) => {
    setIsProcessing(true);
    setError(null);
    
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

      // Deduplicate files by ID
      const existingIds = new Set(files.map(f => f.id));
      const filteredFiles = allFiles.filter(f => !existingIds.has(getFileId(f)));

      if (filteredFiles.length === 0 && allFiles.length > 0) {
        setError("Selected file(s) are already in the queue.");
        return;
      }

      const parsedFiles: ScannedFile[] = [];
      for (const file of filteredFiles) {
        const fileId = getFileId(file);
        try {
          setParseProgress(0);
          
          let text = await getCachedText(fileId);
          if (!text) {
            text = await parseFile(file, (p) => setParseProgress(p));
            await setCachedText(fileId, text);
          } else {
            setParseProgress(100);
          }

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

  const removeFile = async (fileId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    await deleteCachedText(fileId);
    parsedTextCache.delete(fileId);

    setFiles((prev) => {
      const nextFiles = prev.filter(f => f.id !== fileId);
      if (activeFileId === fileId) {
        setActiveFileId(nextFiles.length > 0 ? nextFiles[0].id : null);
      }
      return nextFiles;
    });

    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });

    setSearchResults((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  };

  const handleClearAll = async () => {
    setFiles([]);
    setActiveFileId(null);
    setSelectedFileIds(new Set());
    parsedTextCache.clear();
    setSearchResults({});
    await clearAllCachedText();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleCopyText = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError("Failed to copy text to clipboard.");
    }
  };

  const activeFile = useMemo(() => {
    return files.find(f => f.id === activeFileId) || null;
  }, [files, activeFileId]);

  const activeKeywords = useMemo(() => {
    if (useRegex) {
      if (keywords.trim().length === 0) return [];
      return [keywords.trim()];
    }
    return keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }, [keywords, useRegex]);

  const sortedFiles = useMemo(() => {
    let list = [...files];

    if (queueSearch.trim()) {
      const query = queueSearch.toLowerCase().trim();
      list = list.filter(f => 
        f.file.name.toLowerCase().includes(query) || 
        f.detectedType.toLowerCase().includes(query)
      );
    }

    switch (sortOption) {
      case 'name-asc':
        return list.sort((a, b) => a.file.name.localeCompare(b.file.name));
      case 'name-desc':
        return list.sort((a, b) => b.file.name.localeCompare(a.file.name));
      case 'size-asc':
        return list.sort((a, b) => a.file.size - b.file.size);
      case 'size-desc':
        return list.sort((a, b) => b.file.size - a.file.size);
      case 'type-asc':
        return list.sort((a, b) => a.detectedType.localeCompare(b.detectedType));
      case 'type-desc':
        return list.sort((a, b) => b.detectedType.localeCompare(a.detectedType));
      default:
        return list;
    }
  }, [files, queueSearch, sortOption]);

  const topMatchesSummary = useMemo(() => {
    if (activeKeywords.length === 0) return [];
    return files
      .map(f => {
        const matchCount = searchResults[f.id]?.totalMatches || 0;
        return {
          file: f,
          matches: matchCount
        };
      })
      .filter(d => d.matches > 0)
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 5);
  }, [files, searchResults, activeKeywords]);

  // Delegate search to Web Worker
  useEffect(() => {
    if (files.length === 0) return;

    files.forEach(f => {
      const fullText = parsedTextCache.get(f.id) || f.previewText;
      const scanId = (activeScansRef.current[f.id] || 0) + 1;
      activeScansRef.current[f.id] = scanId;

      if (searchWorkerRef.current) {
        searchWorkerRef.current.postMessage({
          scanId,
          fileId: f.id,
          text: fullText,
          keywords: activeKeywords,
          isRegex: useRegex
        });
      }
    });
  }, [keywords, useRegex, files]);

  const activeFileMatches = activeFile ? (searchResults[activeFile.id]?.matches || []) : [];
  const activeFileTotalMatches = activeFile ? (searchResults[activeFile.id]?.totalMatches || activeFileMatches.length) : 0;
  const activeFileSearching = activeFile ? (searchResults[activeFile.id]?.isSearching || false) : false;

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

  const handleExport = async (format: 'txt' | 'md' | 'json' | 'pdf') => {
    const filesToExport = sortedFiles.filter(f => selectedFileIds.has(f.id));
    if (filesToExport.length === 0) return;
    
    if (filesToExport.length === 1) {
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

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-slate-300 font-sans selection:bg-blue-500/30">
      {previewFormat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0e1014] border border-white/10 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden shadow-2xl animate-scale-in">
            <div className="px-6 py-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
              <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-400" /> Print Preview: {previewFormat.toUpperCase()}
              </h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleCopyText(getPreviewFormattedContent(previewFormat))}
                  className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? "Copied!" : "Copy Text"}</span>
                </button>
                <button onClick={() => setPreviewFormat(null)} className="text-white/40 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 bg-slate-100 text-black">
              <div className={previewFormat === 'pdf' ? "max-w-[180mm] mx-auto bg-white p-8 shadow-sm border border-slate-200" : ""}>
                <pre className={cn("font-mono text-xs whitespace-pre-wrap", previewFormat === 'pdf' ? "text-black font-sans leading-relaxed" : "text-slate-800")}>
                  {getPreviewFormattedContent(previewFormat)}
                </pre>
              </div>
            </div>
            <div className="p-4 border-t border-white/5 bg-[#0e1014] flex justify-end gap-3">
              <button onClick={() => setPreviewFormat(null)} className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors">Cancel</button>
              <button onClick={() => { handleExport(previewFormat); setPreviewFormat(null); }} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium shadow-lg shadow-blue-500/20">
                Download {previewFormat.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}
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
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Queue ({files.length})</h2>
                    <select 
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value)}
                      className="bg-transparent border border-white/10 text-white/60 text-[10px] rounded px-1.5 py-0.5 outline-none cursor-pointer hover:border-white/20"
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
                    <button onClick={handleClearAll} className="text-[10px] text-red-400 hover:text-red-300 transition-colors">Clear All</button>
                  </div>
                </div>

                {files.length > 3 && (
                  <div className="relative mb-3">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-white/30" />
                    <input
                      type="text"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                      placeholder="Filter queue files..."
                      className="w-full pl-9 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-md text-xs text-white focus:outline-none focus:border-blue-500/50 placeholder-white/20"
                    />
                  </div>
                )}

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {sortedFiles.map((f) => {
                    const isSearching = searchResults[f.id]?.isSearching || false;
                    const matchCount = searchResults[f.id]?.totalMatches || 0;
                    const isSelected = selectedFileIds.has(f.id);
                    return (
                      <div 
                        key={f.id} 
                        className={cn(
                          "p-3 rounded-lg border flex items-center gap-3 transition-colors group relative",
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
                              <div className="flex items-center gap-1 shrink-0">
                                {isSearching ? (
                                  <div className="w-3.5 h-3.5 border border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
                                ) : activeKeywords.length > 0 && matchCount > 0 ? (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded shrink-0">{matchCount}</span>
                                ) : null}
                                <button
                                  onClick={(e) => removeFile(f.id, e)}
                                  className="p-1 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                  title="Remove file"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
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

            {topMatchesSummary.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2">Top Hits by File</div>
                <div className="space-y-1.5">
                  {topMatchesSummary.map(({ file, matches }) => (
                    <div 
                      key={file.id} 
                      onClick={() => setActiveFileId(file.id)}
                      className="flex items-center justify-between text-xs p-2 rounded bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors border border-white/5"
                    >
                      <span className="truncate text-white/80 pr-2">{file.file.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded font-mono font-bold shrink-0">
                        {matches} {matches === 1 ? 'hit' : 'hits'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="bg-white/[0.02] p-6 rounded-xl border border-white/5">
            <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4 block">
              {selectedFileIds.size > 1 ? `Batch Export (${selectedFileIds.size} Selected)` : 'Export Format'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative group flex flex-col">
                <button onClick={() => handleExport('txt')} disabled={selectedFileIds.size === 0} className="w-full flex-1 py-4 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1">
                  <FileText className="w-5 h-5 mb-1 opacity-70" />
                  <span className="text-sm font-bold">TXT</span>
                </button>
                <button onClick={() => setPreviewFormat('txt')} disabled={!activeFile} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-blue-500/20 text-white/40 hover:text-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:hidden" title="Print Preview">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              <div className="relative group flex flex-col">
                <button onClick={() => handleExport('md')} disabled={selectedFileIds.size === 0} className="w-full flex-1 py-4 rounded-xl border border-blue-500/50 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1 ring-1 ring-blue-500/20">
                  <FileText className="w-5 h-5 mb-1 opacity-90" />
                  <span className="text-sm font-bold">Markdown</span>
                </button>
                <button onClick={() => setPreviewFormat('md')} disabled={!activeFile} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-blue-500/20 text-white/40 hover:text-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:hidden" title="Print Preview">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              <div className="relative group flex flex-col">
                <button onClick={() => handleExport('json')} disabled={selectedFileIds.size === 0} className="w-full flex-1 py-4 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1">
                  <FileJson className="w-5 h-5 mb-1 opacity-70" />
                  <span className="text-sm font-bold">JSON</span>
                </button>
                <button onClick={() => setPreviewFormat('json')} disabled={!activeFile} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-blue-500/20 text-white/40 hover:text-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:hidden" title="Print Preview">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              <div className="relative group flex flex-col">
                <button onClick={() => handleExport('pdf')} disabled={selectedFileIds.size === 0} className="w-full flex-1 py-4 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1">
                  <Download className="w-5 h-5 mb-1 opacity-70" />
                  <span className="text-sm font-bold">PDF</span>
                </button>
                <button onClick={() => setPreviewFormat('pdf')} disabled={!activeFile} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-blue-500/20 text-white/40 hover:text-blue-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all disabled:hidden" title="Print Preview">
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Virtualized Preview */}
        <div className="lg:col-span-8">
          <section className="bg-black/40 rounded-xl border border-white/5 h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 bg-[#0e1014]/50 flex items-center justify-between">
              <h2 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                Live Inspection Console 
                {activeFileSearching ? (
                  <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin ml-2" />
                ) : activeKeywords.length > 0 && activeFileTotalMatches > 0 ? (
                  <span className="text-blue-400 ml-2 border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 rounded">
                    ({activeFileTotalMatches} matches)
                  </span>
                ) : null}
              </h2>
            </div>
            
            <div className="flex-1 p-6 bg-transparent overflow-hidden">
              {isProcessing ? (
                <div className="flex flex-col items-center justify-center h-full text-white/40 space-y-4 animate-fade-in">
                  <div className="relative flex items-center justify-center">
                    <div className="w-12 h-12 border-4 border-white/5 border-t-blue-500 rounded-full animate-spin" />
                    <span className="absolute text-[10px] font-bold text-blue-400 font-mono">{parseProgress}%</span>
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-xs text-white/80 font-semibold">[SYSTEM] Parsing & converting source chunks via Web Worker...</p>
                    <p className="text-[10px] text-white/40">Background thread processing • {parseProgress}% complete</p>
                  </div>
                </div>
              ) : !activeFile ? (
                <div className="flex flex-col items-center justify-center h-full text-white/20 animate-fade-in">
                  <FileType className="w-12 h-12 mb-3 text-white/10" />
                  <p>Awaiting source file...</p>
                </div>
              ) : (
                <div className="flex flex-col h-full space-y-4">
                  {activeKeywords.length > 0 && activeFileMatches.length > 0 && (
                    <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl shrink-0">
                      <h3 className="font-bold text-xs text-blue-400 mb-3 uppercase tracking-widest flex items-center gap-2">
                        [KEYWORD MATCHES] ({activeFileTotalMatches})
                        {activeFileSearching && <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />}
                      </h3>
                      <ul className="space-y-2 max-h-48 overflow-y-auto pr-2">
                        {activeFileMatches.slice(0, 50).map((match, idx) => (
                          <li key={idx} className="p-2.5 bg-black/40 rounded-lg text-xs border border-white/5 text-white/60 font-mono truncate">
                            <HighlightedLine line={match} keywords={activeKeywords} isRegex={useRegex} />
                          </li>
                        ))}
                        {activeFileTotalMatches > 50 && (
                          <li className="text-center text-blue-400/60 text-xs mt-2">
                            + {activeFileTotalMatches - 50} more hits...
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  <div className="flex-1 min-h-0 bg-black/20 rounded-lg border border-white/5 p-4">
                    <VirtualizedText
                      text={parsedTextCache.get(activeFile.id) || activeFile.previewText}
                      keywords={activeKeywords}
                      isRegex={useRegex}
                    />
                  </div>
                </div>
              )}
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
      return (
        <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-8">
          <div className="max-w-xl w-full bg-red-500/10 border border-red-500/20 p-8 rounded-2xl text-center">
            <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-xl font-bold text-white mb-4">A rendering error occurred</h1>
            <p className="text-red-400 text-sm mb-6 font-mono whitespace-pre-wrap text-left break-all bg-black/40 p-4 rounded-lg overflow-x-auto">
              {this.state.error?.toString()}
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
