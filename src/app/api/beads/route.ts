import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import type { BeatListFilters } from "@/lib/backend-port";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import { backendErrorStatus } from "@/lib/backend-http";
import { createBeatSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const query = params.q;
  delete params.q;
  const raw = query
    ? await getBackend().search(query, params as BeatListFilters, repoPath)
    : await getBackend().list(params as BeatListFilters, repoPath);
  const fn = query ? "searchBeads" : "listBeads";
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
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const workflowsResult = await getBackend().listWorkflows(repoPath);
  if (!workflowsResult.ok) {
    return NextResponse.json(
      { error: workflowsResult.error?.message ?? "Failed to list workflows" },
      { status: backendErrorStatus(workflowsResult.error) },
    );
  }

  const workflows = workflowsResult.data ?? [];
  if (workflows.length === 0) {
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
    return NextResponse.json(
      { error: result.error?.message },
      { status: backendErrorStatus(result.error) },
    );
  }
  return NextResponse.json({ data: result.data }, { status: 201 });
}
