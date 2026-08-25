import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/db/client";
import { callClaude } from "@/extract/client";
import type { Deps } from "./documents";

export function realDeps(): Deps {
  const dataDir = process.env.DATA_DIR ?? "./data";
  return {
    db: getDb(),
    call: callClaude,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    dataDir,
    writeFile: async (filePath, bytes) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, bytes);
    },
  };
}
