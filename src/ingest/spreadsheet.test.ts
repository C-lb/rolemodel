import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { readCsv, readSpreadsheet } from "./spreadsheet";
import { IngestError } from "./types";

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("readSpreadsheet", () => {
  it("returns one grid per sheet with values in row order", async () => {
    const buf = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("Income");
      ws.addRow(["Line item", "FY2024"]);
      ws.addRow(["Revenue", 1000]);
    });
    const sheets = await readSpreadsheet(buf);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Income");
    expect(sheets[0].rows[0]).toEqual(["Line item", "FY2024"]);
    expect(sheets[0].rows[1]).toEqual(["Revenue", 1000]);
  });

  it("uses the computed result for formula cells, not the formula text", async () => {
    const buf = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("Calc");
      ws.getCell("A1").value = { formula: "1+1", result: 2 };
    });
    const sheets = await readSpreadsheet(buf);
    expect(sheets[0].rows[0][0]).toBe(2);
  });

  it("pads short rows so every row has the same width", async () => {
    const buf = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("Ragged");
      ws.addRow(["a", "b", "c"]);
      ws.addRow(["d"]);
    });
    const sheets = await readSpreadsheet(buf);
    expect(sheets[0].rows[1]).toEqual(["d", null, null]);
  });

  it("throws empty_workbook when no sheet has any data", async () => {
    const buf = await workbookBuffer((wb) => {
      wb.addWorksheet("Blank");
    });
    await expect(readSpreadsheet(buf)).rejects.toMatchObject({ code: "empty_workbook" });
  });

  it("throws unreadable for bytes that are not a workbook", async () => {
    await expect(readSpreadsheet(Buffer.from("not a spreadsheet"))).rejects.toBeInstanceOf(IngestError);
  });
});

describe("readCsv", () => {
  it("returns one grid in the same shape as a workbook sheet", async () => {
    const csv = "Line item,FY2024\nRevenue,1000\n";
    const sheets = await readCsv(Buffer.from(csv));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].rows[0]).toEqual(["Line item", "FY2024"]);
    expect(sheets[0].rows[1]).toEqual(["Revenue", 1000]);
  });

  it("names the single sheet, since a CSV carries no sheet name", async () => {
    const sheets = await readCsv(Buffer.from("a,b\n1,2\n"));
    expect(sheets[0].name).toBe("CSV");
  });

  it("pads short rows so every row has the same width", async () => {
    const sheets = await readCsv(Buffer.from("a,b,c\nd\n"));
    expect(sheets[0].rows[1]).toEqual(["d", null, null]);
  });

  it("throws empty_workbook for a CSV with no data", async () => {
    await expect(readCsv(Buffer.from(""))).rejects.toMatchObject({ code: "empty_workbook" });
  });
});
