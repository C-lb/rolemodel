"use server";

import { revalidatePath } from "next/cache";
import { realDeps } from "@/server/deps";
import { ingestAndExtract, setOverride, type ActionResult } from "@/server/documents";
import { remapFact } from "@/server/remap";
import { saveCustomRatio, deleteCustomRatio, setAveragingMode } from "@/server/ratios";
import {
  createScenario,
  renameScenario,
  duplicateScenario,
  deleteScenario,
  setActiveScenario,
  saveDriver,
  fillRight,
  setForecastHorizon,
} from "@/server/scenarios";
import { buildForecastInput } from "@/server/forecast";
import { explainRatio as explain, type RatioReading } from "@/server/interpretation";
import { computeRatios, type RatioResult } from "@/model/ratios/compute";
import { loadWorkspace } from "@/server/documents";
import type { AveragingMode } from "@/model/ratios/types";
import type { ForecastInput } from "@/model/forecast/engine";
import { sensitivityGrid, type Axis, type SensitivityOutput, type SensitivityResult } from "@/model/forecast/sensitivity";

const DB_ERROR_REMEDIATION =
  "Try again. If it keeps happening, check the terminal running the app for the full database error.";

export async function uploadDocument(formData: FormData): Promise<ActionResult<{ workspaceId: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, code: "no_file", message: "No file was received.", remediation: "Pick a file and try again." };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch (error) {
    return {
      ok: false, code: "upload_failed", message: (error as Error).message,
      remediation: "The file did not finish uploading. Check your connection and try again.",
    };
  }
  const result = await ingestAndExtract(realDeps(), file.name, bytes);
  if (result.ok) revalidatePath(`/w/${result.data.workspaceId}`);
  return result;
}

export async function saveOverride(
  workspaceId: string, canonicalKey: string, periodKey: string, value: number,
): Promise<ActionResult<null>> {
  if (!Number.isFinite(value)) {
    return { ok: false, code: "bad_number", message: `"${value}" is not a number.`, remediation: "Enter a plain number. Use a minus sign for negatives." };
  }
  try {
    await setOverride(realDeps(), workspaceId, canonicalKey, periodKey, value);
  } catch (error) {
    return { ok: false, code: "db_error", message: (error as Error).message, remediation: DB_ERROR_REMEDIATION };
  }
  revalidatePath(`/w/${workspaceId}`);
  return { ok: true, data: null };
}

export async function clearOverride(
  workspaceId: string, canonicalKey: string, periodKey: string,
): Promise<ActionResult<null>> {
  try {
    await setOverride(realDeps(), workspaceId, canonicalKey, periodKey, null);
  } catch (error) {
    return { ok: false, code: "db_error", message: (error as Error).message, remediation: DB_ERROR_REMEDIATION };
  }
  revalidatePath(`/w/${workspaceId}`);
  return { ok: true, data: null };
}

export async function remapLineItem(
  workspaceId: string, factId: string, toCanonicalKey: string,
): Promise<ActionResult<null>> {
  try {
    await remapFact(realDeps(), workspaceId, factId, toCanonicalKey);
  } catch (error) {
    return {
      ok: false, code: "remap_failed", message: (error as Error).message,
      remediation: "Pick a different target line, or clear the existing value there first.",
    };
  }
  revalidatePath(`/w/${workspaceId}`);
  return { ok: true, data: null };
}

export async function setAveraging(
  workspaceId: string, mode: AveragingMode,
): Promise<ActionResult<null>> {
  const result = await setAveragingMode(realDeps(), workspaceId, mode);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function saveRatio(
  workspaceId: string, draft: { label: string; expression: string; note: string | null },
): Promise<ActionResult<{ key: string }>> {
  const result = await saveCustomRatio(realDeps(), { workspaceId, ...draft });
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function deleteRatio(workspaceId: string, key: string): Promise<ActionResult<null>> {
  const result = await deleteCustomRatio(realDeps(), workspaceId, key);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

/**
 * The reading is generated from the numbers the server computes, not from anything the
 * client sends: a client that could choose the figures could ask for a reading of numbers
 * nobody has seen.
 */
export async function explainRatio(
  workspaceId: string, ratioKey: string,
): Promise<ActionResult<RatioReading>> {
  const deps = realDeps();
  const ws = await loadWorkspace(deps, workspaceId);
  const results: RatioResult[] = computeRatios({
    workspace: ws,
    mode: ws.averagingMode,
    custom: ws.customRatios,
  });

  const result = results.find((r) => r.key === ratioKey);
  if (!result) {
    return {
      ok: false, code: "unknown_ratio", message: `No ratio "${ratioKey}" in this workspace.`,
      remediation: "Reload the page and try again.",
    };
  }

  return explain(deps, workspaceId, result, ws.averagingMode);
}

export async function createScenarioAction(
  workspaceId: string, name: string,
): Promise<ActionResult<{ scenarioId: string }>> {
  const result = await createScenario(realDeps(), workspaceId, name);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function renameScenarioAction(
  workspaceId: string, scenarioId: string, name: string,
): Promise<ActionResult<null>> {
  const result = await renameScenario(realDeps(), workspaceId, scenarioId, name);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function duplicateScenarioAction(
  workspaceId: string, scenarioId: string, name: string,
): Promise<ActionResult<{ scenarioId: string }>> {
  const result = await duplicateScenario(realDeps(), workspaceId, scenarioId, name);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function deleteScenarioAction(
  workspaceId: string, scenarioId: string,
): Promise<ActionResult<null>> {
  const result = await deleteScenario(realDeps(), workspaceId, scenarioId);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function selectScenarioAction(
  workspaceId: string, scenarioId: string,
): Promise<ActionResult<null>> {
  const result = await setActiveScenario(realDeps(), workspaceId, scenarioId);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function saveDriverAction(
  workspaceId: string, scenarioId: string, key: string, periodKey: string, value: number,
): Promise<ActionResult<null>> {
  const result = await saveDriver(realDeps(), scenarioId, key, periodKey, value);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function fillRightAction(
  workspaceId: string, scenarioId: string, key: string, fromPeriod: string,
): Promise<ActionResult<null>> {
  const result = await fillRight(realDeps(), scenarioId, key, fromPeriod);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

export async function setHorizonAction(
  workspaceId: string, horizon: number,
): Promise<ActionResult<null>> {
  const result = await setForecastHorizon(realDeps(), workspaceId, horizon);
  if (result.ok) revalidatePath(`/w/${workspaceId}`);
  return result;
}

/**
 * Runs the two-variable sensitivity grid for a scenario. Read-only: nothing is
 * persisted, so there is no `revalidatePath`. The `ForecastInput` is assembled the
 * same way `assembleForecast` (`server/forecast.ts`) builds one, duplicated rather
 * than imported because that function also runs the forecast, which this does not need.
 */
export async function runSensitivityAction(
  workspaceId: string,
  scenarioId: string,
  rowAxis: Axis,
  columnAxis: Axis,
  output: SensitivityOutput,
): Promise<ActionResult<SensitivityResult>> {
  const deps = realDeps();
  let ws: Awaited<ReturnType<typeof loadWorkspace>>;
  let input: ForecastInput;
  try {
    ws = await loadWorkspace(deps, workspaceId);
    input = await buildForecastInput(deps, workspaceId, scenarioId);
  } catch (error) {
    return { ok: false, code: "db_error", message: (error as Error).message, remediation: DB_ERROR_REMEDIATION };
  }

  const result = sensitivityGrid(input, rowAxis, columnAxis, output, ws.customRatios, ws.averagingMode);
  return { ok: true, data: result };
}
