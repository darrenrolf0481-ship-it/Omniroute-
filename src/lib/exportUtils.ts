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

function generatePdfDoc(text: string): jsPDF {
  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.height;
  const margin = 15;
  const maxWidth = 180;
  const maxPdfLines = 5000;

  let textToRender = text;
  const totalLineCount = (text.match(/\n/g) || []).length + 1;

  if (totalLineCount > maxPdfLines) {
    const truncatedText = text.split('\n').slice(0, maxPdfLines).join('\n');
    textToRender = `${truncatedText}\n\n--- [PDF EXPORT TRUNCATED AT ${maxPdfLines} LINES] ---\n[Use TXT or Markdown export to view full ${totalLineCount.toLocaleString()} lines]`;
  }

  const lines = doc.splitTextToSize(textToRender, maxWidth);
  let cursorY = margin;

  for (let i = 0; i < lines.length; i++) {
    if (cursorY > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
    doc.text(lines[i], margin, cursorY);
    cursorY += 6;
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
