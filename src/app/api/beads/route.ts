import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import type { BeadListFilters } from "@/lib/backend-port";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import { backendErrorStatus } from "@/lib/backend-http";
import { createBeadSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const query = params.q;
  delete params.q;
  const raw = query
    ? await getBackend().search(query, params as BeadListFilters, repoPath)
    : await getBackend().list(params as BeadListFilters, repoPath);
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
  const parsed = createBeadSchema.safeParse(rest);
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

  const selectedWorkflowId = parsed.data.workflowId;
  if (workflows.length > 1 && !selectedWorkflowId) {
    return NextResponse.json(
      { error: "workflowId is required when multiple workflows are available." },
      { status: 400 },
    );
  }

  if (selectedWorkflowId && !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
    return NextResponse.json(
      { error: `Unknown workflowId "${selectedWorkflowId}".` },
      { status: 400 },
    );
  }

  const input = selectedWorkflowId
    ? parsed.data
    : { ...parsed.data, workflowId: workflows[0]!.id };

  const result = await getBackend().create(input, repoPath);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error?.message },
      { status: backendErrorStatus(result.error) },
    );
  }
  return NextResponse.json({ data: result.data }, { status: 201 });
}
