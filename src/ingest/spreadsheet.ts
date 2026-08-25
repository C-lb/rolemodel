import ExcelJS from "exceljs";
import { IngestError, type SheetGrid } from "./types";

type CellValue = string | number | null;

function normaliseCell(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "result" in value) {
    const result = (value as ExcelJS.CellFormulaValue).result;
    return typeof result === "number" || typeof result === "string" ? result : null;
  }
  if (typeof value === "object" && "richText" in value) {
    return (value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("").trim() || null;
  }
  if (typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text).trim() || null;
  }
  return null;
}

export async function readSpreadsheet(bytes: Buffer): Promise<SheetGrid[]> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs declares its own ambient `Buffer` type (an ArrayBuffer-like shape) that
    // shadows Node's Buffer, so a Node Buffer doesn't typecheck directly here — pass a
    // real ArrayBuffer slice instead.
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await wb.xlsx.load(arrayBuffer);
  } catch (cause) {
    throw new IngestError("unreadable", `Could not read the workbook: ${(cause as Error).message}`);
  }

  const grids: SheetGrid[] = [];
  wb.eachSheet((ws) => {
    const rows: CellValue[][] = [];
    let width = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: CellValue[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(normaliseCell(cell.value)));
      width = Math.max(width, cells.length);
      rows.push(cells);
    });
    const padded = rows.map((r) => [...r, ...Array<CellValue>(width - r.length).fill(null)]);
    if (padded.some((r) => r.some((c) => c !== null))) {
      grids.push({ name: ws.name, rows: padded });
    }
  });

  if (grids.length === 0) {
    throw new IngestError("empty_workbook", "The workbook has no sheets containing data.");
  }
  return grids;
}
