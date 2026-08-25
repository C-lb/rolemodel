import { z } from "zod";

export const ExtractedFigureSchema = z.object({
  canonical_key: z.string().describe("Canonical line-item key from the supplied list, or 'unmapped'."),
  raw_label: z.string().describe("The label exactly as printed in the source, verbatim."),
  raw_value: z.string().describe("The value exactly as printed, including commas, parentheses and currency symbols."),
  value: z.number().describe("The value converted to base currency units, with the scale factor already applied and parentheses converted to a negative sign."),
  scale_factor: z.number().describe("Multiplier applied to raw_value to reach value: 1, 1000 or 1000000."),
  scale_evidence: z.string().describe("The text in the document that establishes the scale, e.g. '(in thousands, except per share data)'. Empty string if the figures are stated in units."),
  sign_flipped: z.boolean().describe("True if the printed figure was in parentheses or otherwise presented as a negative."),
  period_key: z.string().describe("Period identifier in the form FY2024 or Q2-2025."),
  page: z.number().nullable().describe("1-indexed page number for PDF sources, null for spreadsheets."),
  sheet: z.string().nullable().describe("Sheet name for spreadsheet sources, null for PDFs."),
  locator: z.string().describe("Short human-readable position hint, e.g. 'Consolidated Balance Sheets, row 4'."),
  confidence: z.number().min(0).max(1).describe("How confident you are in this figure and its mapping."),
});

export const ExtractionSchema = z.object({
  periods: z.array(z.string()).describe("Every period present in this content, most recent first."),
  currency: z.string().describe("ISO currency code of the figures, e.g. USD. Empty string if not stated."),
  figures: z.array(ExtractedFigureSchema),
  unmapped_labels: z.array(z.string()).describe("Labels you saw that carried a financial figure but could not be mapped to any canonical key."),
  notes: z.string().describe("Anything ambiguous a reviewer should check. Empty string if nothing."),
});

export type ExtractionResult = z.infer<typeof ExtractionSchema>;
export type ExtractedFigure = z.infer<typeof ExtractedFigureSchema>;
