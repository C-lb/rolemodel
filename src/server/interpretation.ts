import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { MODEL_ID, MissingApiKeyError } from "@/extract/client";
import {
  buildInterpretPayload,
  interpretRatio,
  payloadHash,
  InterpretationRefusedError,
  INTERPRET_PROMPT_VERSION,
  type CallResult,
  type InterpretPayload,
} from "@/extract/interpret";
import { ratio as builtinRatio } from "@/model/ratios/library";
import type { RatioResult } from "@/model/ratios/compute";
import type { AveragingMode } from "@/model/ratios/types";
import type { ActionResult, Deps } from "./documents";

/** The generation seam, so the cache is testable without the network. */
export interface InterpretDeps extends Deps {
  interpret?: (payload: InterpretPayload) => Promise<CallResult>;
}

export interface RatioReading {
  text: string;
  declined: boolean;
  reason: string | null;
  cached: boolean;
}

function failure(code: string, message: string, remediation: string): ActionResult<never> {
  return { ok: false, code, message, remediation };
}

export async function explainRatio(
  deps: InterpretDeps,
  workspaceId: string,
  result: RatioResult,
  mode: AveragingMode,
): Promise<ActionResult<RatioReading>> {
  const valued = result.periods.filter((p) => p.state === "ok" && p.value !== undefined);
  if (valued.length === 0) {
    return failure(
      "nothing_to_explain",
      `${result.label} has no value in any period, so there is nothing to read.`,
      "Fix the missing figures behind this ratio first. The card lists which ones they are.",
    );
  }

  const payload = buildInterpretPayload(result, builtinRatio(result.key) ?? null, mode);
  const hash = payloadHash(payload, MODEL_ID);

  const cached = deps.db
    .select()
    .from(schema.interpretations)
    .where(
      and(
        eq(schema.interpretations.workspaceId, workspaceId),
        eq(schema.interpretations.ratioKey, result.key),
        eq(schema.interpretations.inputHash, hash),
      ),
    )
    .get();

  if (cached) {
    return {
      ok: true,
      data: {
        text: cached.text,
        declined: cached.declined === 1,
        reason: cached.reason,
        cached: true,
      },
    };
  }

  const generate = deps.interpret ?? ((p: InterpretPayload) => interpretRatio(p));

  let reading: CallResult;
  try {
    reading = await generate(payload);
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      return failure(
        "missing_api_key",
        error.message,
        "Add ANTHROPIC_API_KEY to .env.local and restart the dev server. The numbers and the definition are unaffected.",
      );
    }
    if (error instanceof InterpretationRefusedError) {
      return failure(
        "refused",
        error.message,
        "The numbers and the definition are still shown. Nothing is wrong with the ratio itself.",
      );
    }
    return failure(
      "interpretation_failed",
      error instanceof Error ? error.message : "The reading could not be generated.",
      "Try again. The numbers and the definition are unaffected either way.",
    );
  }

  // A decline is cached like any other outcome: the same numbers produce the same
  // decline, and paying for it twice teaches nothing new.
  deps.db
    .insert(schema.interpretations)
    .values({
      id: deps.newId(),
      workspaceId,
      ratioKey: result.key,
      inputHash: hash,
      text: reading.text,
      declined: reading.declined ? 1 : 0,
      reason: reading.reason,
      modelId: MODEL_ID,
      promptVersion: INTERPRET_PROMPT_VERSION,
      tokensIn: reading.tokensIn,
      tokensOut: reading.tokensOut,
      createdAt: deps.now(),
    })
    .run();

  return {
    ok: true,
    data: { text: reading.text, declined: reading.declined, reason: reading.reason, cached: false },
  };
}
