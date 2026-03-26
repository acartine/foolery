import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import type { BeatListFilters } from "@/lib/backend-port";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import { backendErrorStatus } from "@/lib/backend-http";
import { createBeatSchema } from "@/lib/schemas";
import { logApiError } from "@/lib/server-logger";
import { enqueueBeatScopeRefinement } from "@/lib/scope-refinement-worker";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const query = params.q;
  delete params.q;
  const raw = query
    ? await getBackend().search(query, params as BeatListFilters, repoPath)
    : await getBackend().list(params as BeatListFilters, repoPath);
  const fn = query ? "searchBeats" : "listBeats";
  const result = withErrorSuppression(fn, raw, params, repoPath, query);
  if (!result.ok) {
    const status = result.error?.message === DEGRADED_ERROR_MESSAGE
      ? 503
      : backendErrorStatus(result.error);
    return NextResponse.json({ error: result.error?.message }, { status });
  }
  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = createBeatSchema.safeParse(rest);
  if (!parsed.success) {
    logApiError({ method: "POST", path: "/api/beats", status: 400, error: "Validation failed" });
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const workflowsResult = await getBackend().listWorkflows(repoPath);
  if (!workflowsResult.ok) {
    const wfError = workflowsResult.error?.message ?? "Failed to list workflows";
    const wfStatus = backendErrorStatus(workflowsResult.error);
    logApiError({ method: "POST", path: "/api/beats", status: wfStatus, error: wfError });
    return NextResponse.json(
      { error: wfError },
      { status: wfStatus },
    );
  }

  const workflows = workflowsResult.data ?? [];
  if (workflows.length === 0) {
    logApiError({ method: "POST", path: "/api/beats", status: 400, error: "Repository does not expose any supported workflows." });
    return NextResponse.json(
      { error: "Repository does not expose any supported workflows." },
      { status: 400 },
    );
  }

  const selectedWorkflowId = parsed.data.profileId ?? parsed.data.workflowId;
  const defaultWorkflowId = workflows.find((workflow) => workflow.id === "autopilot")?.id ?? workflows[0]!.id;

  if (selectedWorkflowId && !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
    return NextResponse.json(
      { error: `Unknown profileId "${selectedWorkflowId}".` },
      { status: 400 },
    );
  }

  const input = selectedWorkflowId
    ? { ...parsed.data, profileId: selectedWorkflowId }
    : { ...parsed.data, profileId: defaultWorkflowId };

  const result = await getBackend().create(input, repoPath);
  if (!result.ok) {
    const createStatus = backendErrorStatus(result.error);
    logApiError({ method: "POST", path: "/api/beats", status: createStatus, error: result.error?.message });
    return NextResponse.json(
      { error: result.error?.message },
      { status: createStatus },
    );
  }
  const createdBeatId = result.data!.id;
  let srResult: { enqueued: boolean; reason?: string };
  try {
    srResult = await enqueueBeatScopeRefinement(
      createdBeatId,
      repoPath,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.warn(
      `[scope-refinement] enqueue error for ${createdBeatId}: ${message}`,
    );
    srResult = { enqueued: false, reason: "error" };
  }
  return NextResponse.json(
    { data: result.data, scopeRefinement: srResult },
    { status: 201 },
  );
}
