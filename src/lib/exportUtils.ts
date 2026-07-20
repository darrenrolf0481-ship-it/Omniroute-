import { jsPDF } from "jspdf";
import JSZip from "jszip";

export function downloadTxt(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain" });
  downloadBlob(blob, `${filename}.txt`);
}

export function downloadMd(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/markdown" });
  downloadBlob(blob, `${filename}.md`);
}

export function downloadJson(data: object, filename: string) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  downloadBlob(blob, `${filename}.json`);
}

export function downloadPdf(text: string, filename: string) {
  const doc = generatePdfDoc(text);
  doc.save(`${filename}.pdf`);
}

// jsPDF's text layout is O(n) main-thread work with heavy per-line overhead; a
// multi-hundred-MB document would freeze the tab, so cap PDF output size.
const PDF_CHAR_LIMIT = 1_000_000;

function generatePdfDoc(text: string): jsPDF {
  if (text.length > PDF_CHAR_LIMIT) {
    text = `${text.slice(0, PDF_CHAR_LIMIT)}\n\n[Document truncated: source exceeds the PDF export size limit. Use TXT/MD/JSON export for the full content.]`;
  }
  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.height;
  const margin = 15;
  const maxWidth = 180;
  
  const lines = doc.splitTextToSize(text, maxWidth);
  let cursorY = margin;

  for (let i = 0; i < lines.length; i++) {
    if (cursorY > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
    doc.text(lines[i], margin, cursorY);
    cursorY += 6; // approximate line height for default font
  }
  return doc;
}

export async function downloadBatchZip(
  files: { content: string | object, filename: string, type: 'txt' | 'md' | 'json' | 'pdf' }[],
  zipName: string = "export.zip"
) {
  const zip = new JSZip();

  for (const file of files) {
    if (file.type === 'pdf') {
      const doc = generatePdfDoc(file.content as string);
      const pdfBlob = doc.output('blob');
      zip.file(`${file.filename}.pdf`, pdfBlob);
    } else if (file.type === 'json') {
      zip.file(`${file.filename}.json`, JSON.stringify(file.content, null, 2));
    } else {
      zip.file(`${file.filename}.${file.type}`, file.content as string);
    }
  }

  const content = await zip.generateAsync({ type: "blob" });
  downloadBlob(content, zipName);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
