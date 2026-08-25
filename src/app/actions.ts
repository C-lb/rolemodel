"use server";

import { revalidatePath } from "next/cache";
import { realDeps } from "@/server/deps";
import { ingestAndExtract, setOverride, type ActionResult } from "@/server/documents";

const DB_ERROR_REMEDIATION =
  "Try again. If it keeps happening, check the terminal running the app for the full database error.";

export async function uploadDocument(formData: FormData): Promise<ActionResult<{ workspaceId: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, code: "no_file", message: "No file was received.", remediation: "Pick a file and try again." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
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
