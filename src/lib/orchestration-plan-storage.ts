import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  updateKnot,
  type ExecutionPlanRecord,
} from "@/lib/knots";

async function writePlanPayloadFile(
  payload: ExecutionPlanRecord,
): Promise<string> {
  const dir = await mkdtemp(
    join(tmpdir(), "foolery-plan-"),
  );
  const filePath = join(dir, "execution-plan.json");
  await writeFile(
    filePath,
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  return filePath;
}

async function cleanupPlanPayloadFile(
  filePath: string,
): Promise<void> {
  const dirPath = filePath.replace(/\/execution-plan\.json$/u, "");
  await rm(filePath, { force: true }).catch(() => undefined);
  await rm(dirPath, {
    force: true,
    recursive: true,
  }).catch(() => undefined);
}

export async function persistPlanPayload(
  planId: string,
  payload: ExecutionPlanRecord,
  repoPath: string,
): Promise<void> {
  const filePath = await writePlanPayloadFile(payload);
  try {
    const updateResult = await updateKnot(
      planId,
      { executionPlanFile: filePath },
      repoPath,
    );
    if (!updateResult.ok) {
      throw new Error(
        updateResult.error ??
          "Failed to persist execution plan payload.",
      );
    }
  } finally {
    await cleanupPlanPayloadFile(filePath);
  }
}
