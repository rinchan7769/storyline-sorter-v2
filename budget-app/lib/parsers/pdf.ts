import path from "node:path";
import { PDFParse } from "pdf-parse";
import { parseStatementText, type StatementParseResult } from "./statement";

// フォント非埋め込みの日本語PDFを読むために、pdfjs-dist 同梱の CMap を参照させる
const CMAP_URL = path.join(process.cwd(), "node_modules", "pdfjs-dist", "cmaps") + path.sep;

export async function parsePdfStatement(data: Buffer): Promise<StatementParseResult & { text: string }> {
  const parser = new PDFParse({ data: new Uint8Array(data), cMapUrl: CMAP_URL, cMapPacked: true });
  try {
    const { text } = await parser.getText();
    return { ...parseStatementText(text), text };
  } finally {
    await parser.destroy();
  }
}
