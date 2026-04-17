#!/usr/bin/env node
// Live validator for the execution-plan REST API.
//
// Hits POST /api/plans + GET /api/plans/:id against a real Knots repo and
// asserts that the returned record matches the spec's plan / wave / step /
// beat structure. Pairs with scripts/test-plans-live.sh, which sets up a
// disposable Stitch worktree and starts the dev server.

import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const baseUrl = required(args, "base-url");
const repoPath = required(args, "repo");
const beatIds = required(args, "beats")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const devLogPath = args["dev-log"] ?? null;
const model = args.model ?? undefined;
const objective = args.objective ?? undefined;

if (beatIds.length === 0) {
  exitWith({
    category: "beat_selection_invalid",
    message: "No beat ids supplied (--beats=...).",
  });
}

const context = { baseUrl, repoPath, beatIds, devLogPath, model, objective };
const created = await createPlan(context);
const fetched = await fetchPlan(context, created.planId);
verifyPlanShape(fetched, context, "GET /api/plans/:id payload");
verifyPersistenceWithKno(context, created.planId);

console.log(JSON.stringify({
  ok: true,
  planId: created.planId,
  repoPath,
  beatIds,
  waves: fetched.plan.waves.length,
  steps: fetched.plan.waves.reduce(
    (total, wave) => total + wave.steps.length,
    0,
  ),
}, null, 2));

// ---------------------------------------------------------------------------
// HTTP helpers + categorized failure handling
// ---------------------------------------------------------------------------

async function createPlan(ctx) {
  const body = {
    repoPath: ctx.repoPath,
    beatIds: ctx.beatIds,
    ...(ctx.objective ? { objective: ctx.objective } : {}),
    ...(ctx.model ? { model: ctx.model } : {}),
  };
  const response = await safeFetch(
    `${ctx.baseUrl}/api/plans`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    ctx,
    { phase: "create_plan" },
  );
  const payload = await readJson(response, ctx, "create_plan");
  if (response.status !== 201) {
    exitWith(categorizeCreateFailure(response, payload, ctx));
  }
  const planRecord = payload?.data;
  if (!planRecord || typeof planRecord !== "object") {
    exitWith({
      category: "create_response_malformed",
      message: "POST /api/plans returned 201 without a data envelope.",
      response: { status: response.status, payload },
      hint:
        "Expected { data: { artifact, plan, progress, lineage, skillPrompt } }.",
      context: ctx,
    });
  }
  verifyPlanShape(planRecord, ctx, "POST /api/plans response");
  return { planId: planRecord.artifact.id };
}

async function fetchPlan(ctx, planId) {
  const url =
    `${ctx.baseUrl}/api/plans/${encodeURIComponent(planId)}` +
    `?repoPath=${encodeURIComponent(ctx.repoPath)}`;
  const response = await safeFetch(url, { method: "GET" }, ctx, {
    phase: "get_plan",
    planId,
  });
  const payload = await readJson(response, ctx, "get_plan");
  if (response.status !== 200) {
    exitWith({
      category: "addressability_failed",
      message:
        `GET /api/plans/:id returned ${response.status} for the plan that ` +
        "POST /api/plans just created.",
      planId,
      response: { status: response.status, payload },
      hint:
        "Created plans must be readable through the same id and repoPath. " +
        "If POST returned a different id than what is persisted, the route " +
        "or canonicalization layer is dropping it before persistence.",
      context: ctx,
    });
  }
  if (!payload?.data) {
    exitWith({
      category: "addressability_failed",
      message: "GET /api/plans/:id returned 200 without a data envelope.",
      planId,
      response: { status: response.status, payload },
      context: ctx,
    });
  }
  return payload.data;
}

async function safeFetch(url, init, ctx, info) {
  try {
    return await fetch(url, init);
  } catch (error) {
    exitWith({
      category: "dev_server_unreachable",
      message:
        `Network error talking to dev server at ${ctx.baseUrl}: ` +
        (error instanceof Error ? error.message : String(error)),
      hint:
        "Confirm the dev server started cleanly. The shell driver writes its " +
        "stdout/stderr to the dev log; check it for crash output.",
      info,
      context: ctx,
    });
  }
}

async function readJson(response, ctx, phase) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    exitWith({
      category: "non_json_response",
      message:
        `${phase}: dev server returned non-JSON body (status ` +
        `${response.status}). Likely an unhandled exception in the route.`,
      bodyExcerpt: text.slice(0, 500),
      context: ctx,
    });
  }
}

function categorizeCreateFailure(response, payload, ctx) {
  const errorText =
    (payload && typeof payload.error === "string" ? payload.error : "") ||
    `HTTP ${response.status}`;
  const lowered = errorText.toLowerCase();
  const base = {
    response: { status: response.status, payload },
    context: ctx,
  };
  if (response.status === 400 && lowered.includes("repopath")) {
    return {
      ...base,
      category: "request_invalid_repo_path",
      message: errorText,
      hint: "POST /api/plans requires a repoPath in the body or query string.",
    };
  }
  if (response.status === 400 && lowered.includes("beatids")) {
    return {
      ...base,
      category: "beat_selection_invalid",
      message: errorText,
      hint:
        "POST /api/plans requires a non-empty beatIds array of existing knots.",
    };
  }
  if (lowered.includes("missing beats")) {
    return {
      ...base,
      category: "beat_selection_missing",
      message: errorText,
      hint:
        "Selected beat ids do not exist in the target repo's .knots store. " +
        "Ensure the disposable worktree has the source repo's .knots/ copied " +
        "into it.",
    };
  }
  if (
    lowered.includes("orchestration agent") ||
    lowered.includes("plan generation") ||
    lowered.includes("agent exited") ||
    lowered.includes("no orchestration agent") ||
    lowered.includes("failed to start")
  ) {
    return {
      ...base,
      category: "planner_runtime_failed",
      message: errorText,
      hint:
        "The configured orchestration agent could not produce a tagged plan. " +
        "Verify the agent CLI is installed, authenticated, and reachable. " +
        "FOOLERY_PLAN_MODEL can override the default model for this run.",
    };
  }
  if (lowered.includes("tagged plan")) {
    return {
      ...base,
      category: "planner_output_invalid",
      message: errorText,
      hint:
        "The agent ran but did not emit a parseable execution_plan tagged " +
        "JSON block. Re-run with FOOLERY_KEEP_TEST_DIR=1 and inspect the dev " +
        "log for the raw planner output.",
    };
  }
  return {
    ...base,
    category: "plan_create_failed",
    message: errorText,
    hint:
      "Unrecognized failure category. Inspect the dev log for stack traces " +
      "and the response body above for the route's error message.",
  };
}

// ---------------------------------------------------------------------------
// Structural assertions: plan / wave / step / beat
// ---------------------------------------------------------------------------

function verifyPlanShape(record, ctx, label) {
  const issues = [];
  const artifact = record?.artifact;
  if (!artifact || artifact.type !== "execution_plan") {
    issues.push({
      kind: "taxonomy_drift",
      message:
        `${label}: artifact.type must be "execution_plan", got ` +
        JSON.stringify(artifact?.type),
    });
  }
  if (!artifact?.id || typeof artifact.id !== "string") {
    issues.push({
      kind: "missing_artifact_id",
      message: `${label}: artifact.id is missing or not a string.`,
    });
  }
  const plan = record?.plan;
  if (!plan || typeof plan !== "object") {
    issues.push({
      kind: "missing_plan_document",
      message: `${label}: plan document is missing.`,
    });
  } else {
    if (plan.repoPath !== ctx.repoPath) {
      issues.push({
        kind: "repo_path_mismatch",
        message:
          `${label}: plan.repoPath ${JSON.stringify(plan.repoPath)} does not ` +
          `match requested ${JSON.stringify(ctx.repoPath)}.`,
      });
    }
    issues.push(...checkBeatIdsCover(plan, ctx, label));
    issues.push(...checkWaves(plan, label));
  }
  const progress = record?.progress;
  if (!progress || typeof progress !== "object") {
    issues.push({
      kind: "missing_progress",
      message: `${label}: progress block is missing.`,
    });
  } else {
    if (!Array.isArray(progress.waves)) {
      issues.push({
        kind: "missing_progress_waves",
        message: `${label}: progress.waves must be an array.`,
      });
    }
    if (!("nextStep" in progress)) {
      issues.push({
        kind: "missing_progress_next_step",
        message: `${label}: progress.nextStep field is missing.`,
      });
    }
  }
  if (typeof record?.skillPrompt !== "string" || !record.skillPrompt.trim()) {
    issues.push({
      kind: "missing_skill_prompt",
      message: `${label}: skillPrompt must be a non-empty string.`,
    });
  }
  if (issues.length > 0) {
    exitWith({
      category: "structural_drift",
      message: `${label} failed structural validation.`,
      issues,
      hint:
        "These checks enforce the plan/wave/step/beat taxonomy from " +
        "src/lib/orchestration-plan-types.ts. Causes seen in the wild: " +
        "(a) the planner emits waves and steps without per-step beatIds, so " +
        "collectBeatIdsFromWaves falls back to []; (b) the persistence layer " +
        "drops top-level beat_ids before kno stores the execution_plan " +
        "payload; (c) the readback path drifts back toward scene/session " +
        "naming. Inspect persisted JSON with `kno -C <repo> show <planId> " +
        "--json` to localize which layer is responsible.",
      context: ctx,
      planRecordExcerpt: excerpt(record),
    });
  }
}

function checkBeatIdsCover(plan, ctx, label) {
  const issues = [];
  if (!Array.isArray(plan.beatIds)) {
    issues.push({
      kind: "missing_plan_beat_ids",
      message: `${label}: plan.beatIds must be an array.`,
    });
    return issues;
  }
  for (const beatId of ctx.beatIds) {
    if (!plan.beatIds.includes(beatId)) {
      issues.push({
        kind: "requested_beat_dropped",
        message:
          `${label}: requested beat ${beatId} is missing from plan.beatIds ` +
          `(${JSON.stringify(plan.beatIds)}).`,
      });
    }
  }
  return issues;
}

function checkWaves(plan, label) {
  const issues = [];
  if (!Array.isArray(plan.waves) || plan.waves.length === 0) {
    issues.push({
      kind: "missing_plan_waves",
      message: `${label}: plan.waves must be a non-empty array.`,
    });
    return issues;
  }
  plan.waves.forEach((wave, waveIdx) => {
    if (typeof wave?.waveIndex !== "number") {
      issues.push({
        kind: "wave_missing_index",
        message:
          `${label}: plan.waves[${waveIdx}].waveIndex must be numeric.`,
      });
    }
    if (!Array.isArray(wave?.steps) || wave.steps.length === 0) {
      issues.push({
        kind: "wave_missing_steps",
        message:
          `${label}: plan.waves[${waveIdx}].steps must be a non-empty array.`,
      });
      return;
    }
    wave.steps.forEach((step, stepIdx) => {
      if (typeof step?.stepIndex !== "number") {
        issues.push({
          kind: "step_missing_index",
          message:
            `${label}: plan.waves[${waveIdx}].steps[${stepIdx}].stepIndex ` +
            "must be numeric.",
        });
      }
      if (!Array.isArray(step?.beatIds)) {
        issues.push({
          kind: "step_missing_beat_ids",
          message:
            `${label}: plan.waves[${waveIdx}].steps[${stepIdx}].beatIds ` +
            "must be an array.",
        });
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Independent persistence verification via `kno show`
// ---------------------------------------------------------------------------

function verifyPersistenceWithKno(ctx, planId) {
  const result = spawnSync(
    "kno",
    ["-C", ctx.repoPath, "show", planId, "--json"],
    { encoding: "utf8" },
  );
  if (result.error) {
    exitWith({
      category: "persistence_check_unrunnable",
      message:
        `Could not invoke kno to verify persistence: ${result.error.message}`,
      hint: "kno must be installed and on PATH to run this harness.",
      context: ctx,
    });
  }
  if (result.status !== 0) {
    exitWith({
      category: "persistence_missing",
      message:
        `kno show ${planId} exited ${result.status}; the plan POST claimed ` +
        "to persist did not land in the repo's .knots store.",
      stderr: result.stderr.slice(0, 500),
      hint:
        "POST /api/plans returned 201 with this id, but kno cannot find the " +
        "knot. createPlan() likely wrote to a different repo than the one we " +
        "passed, or persistPlanPayload() failed silently.",
      context: ctx,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    exitWith({
      category: "persistence_unreadable",
      message: "kno show returned non-JSON output for the persisted plan.",
      stdoutExcerpt: result.stdout.slice(0, 500),
      context: ctx,
    });
  }
  if (parsed?.type !== "execution_plan") {
    exitWith({
      category: "persistence_taxonomy_drift",
      message:
        `Persisted knot type is ${JSON.stringify(parsed?.type)}, expected ` +
        '"execution_plan".',
      hint:
        "createPlan() must use type: \"execution_plan\" when calling newKnot. " +
        "A regression here breaks isPlanKnot() filtering everywhere.",
      context: ctx,
    });
  }
  if (!parsed?.execution_plan || typeof parsed.execution_plan !== "object") {
    exitWith({
      category: "persistence_payload_missing",
      message:
        "Persisted knot has no execution_plan payload; persistPlanPayload() " +
        "did not attach the JSON document.",
      hint:
        "Inspect persistPlanPayload(): the writeKnot/updateKnot call must " +
        "include the executionPlanFile pointer for the payload to survive.",
      context: ctx,
    });
  }
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/u.exec(arg);
    if (!match) continue;
    out[match[1]] = match[2];
  }
  return out;
}

function required(args, key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    exitWith({
      category: "validator_misconfigured",
      message: `Missing required --${key}=... argument to test-plans-live.mjs.`,
    });
  }
  return value;
}

function excerpt(value) {
  try {
    const text = JSON.stringify(value);
    return text && text.length > 800 ? `${text.slice(0, 800)}...` : text;
  } catch {
    return "<unserializable>";
  }
}

function exitWith(detail) {
  const payload = { ok: false, ...detail };
  if (devLogPath) payload.devLogPath = devLogPath;
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
}
