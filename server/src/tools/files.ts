import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';

export async function parseLocalFile(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist at location: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file.`);
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.pdf') {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text || 'Empty PDF document.';
    }

    if (ext === '.docx') {
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer });
      return result.value || 'Empty DOCX document.';
    }

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      let outputText = '';
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_txt(worksheet);
        outputText += `--- Sheet: ${sheetName} ---\n${data}\n\n`;
      }
      return outputText || 'Empty spreadsheet workbook.';
    }

    // Text / Code / JSON / Markdown
    const textExts = ['.txt', '.js', '.ts', '.tsx', '.jsx', '.py', '.html', '.css', '.json', '.md', '.yaml', '.xml', '.ini', '.csv'];
    if (textExts.includes(ext) || stat.size < 500000) { // Safety check to read unknown small files as text
      const content = fs.readFileSync(filePath, 'utf8');
      return content || 'Empty text file.';
    }

    return `Unsupported binary format for direct text ingestion. File Name: ${path.basename(filePath)} (${stat.size} bytes)`;
  } catch (e: any) {
    throw new Error(`Failed to parse file content: ${e.message}`);
  }
}
