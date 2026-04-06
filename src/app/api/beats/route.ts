import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import type { BeatListFilters } from "@/lib/backend-port";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import { backendErrorStatus } from "@/lib/backend-http";
import { createBeatSchema } from "@/lib/schemas";
import { logApiError } from "@/lib/server-logger";
import { withServerTiming } from "@/lib/server-timing";
import { enqueueBeatScopeRefinement } from "@/lib/scope-refinement-worker";
import {
  aggregateBeatsErrorStatus,
  listBeatsAcrossRegisteredRepos,
  streamBeatsAcrossRegisteredRepos,
} from "@/lib/beats-multi-repo";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const scope = params.scope;
  delete params.scope;
  const query = params.q;
  delete params.q;

  return withServerTiming(
    {
      route: "GET /api/beats",
      context: { repoPath, scope, query },
    },
    async ({ measure }) => {
      if (scope === "all" && !repoPath) {
        const wantStream =
          request.headers.get("accept") === "application/x-ndjson";
        if (wantStream) {
          return streamMultiRepoNdjson(
            params as BeatListFilters, query,
          );
        }
        const result = await measure(
          "multi_repo",
          () => listBeatsAcrossRegisteredRepos(
            params as BeatListFilters, query,
          ),
        );
        if (!result.ok) {
          const error = result.error ?? "Request failed";
          return NextResponse.json(
            { error },
            { status: aggregateBeatsErrorStatus(error) },
          );
        }
        return NextResponse.json({
          data: result.data,
          _degraded: result._degraded,
        });
      }

      const raw = query
        ? await measure("search", () => getBackend().search(query, params as BeatListFilters, repoPath))
        : await measure("list", () => getBackend().list(params as BeatListFilters, repoPath));
      const fn = query ? "searchBeats" : "listBeats";
      const result = withErrorSuppression(
        fn,
        raw,
        params,
        repoPath,
        query,
      );
      if (!result.ok) {
        const status = result.error?.message === DEGRADED_ERROR_MESSAGE
          ? 503
          : backendErrorStatus(result.error);
        return NextResponse.json({ error: result.error?.message }, { status });
      }
      return NextResponse.json({ data: result.data });
    },
  );
}

function streamMultiRepoNdjson(
  filters: BeatListFilters,
  query?: string,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const gen = streamBeatsAcrossRegisteredRepos(
          filters, query,
        );
        for await (const chunk of gen) {
          const line = JSON.stringify(chunk) + "\n";
          controller.enqueue(encoder.encode(line));
        }
      } catch (err) {
        const msg = err instanceof Error
          ? err.message : String(err);
        const line = JSON.stringify({ error: msg }) + "\n";
        controller.enqueue(encoder.encode(line));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  return withServerTiming(
    {
      route: "POST /api/beats",
      context: { repoPath },
    },
    async ({ measure }) => {
      const parsed = createBeatSchema.safeParse(rest);
      if (!parsed.success) {
        logApiError({ method: "POST", path: "/api/beats", status: 400, error: "Validation failed" });
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.issues },
          { status: 400 }
        );
      }

      const workflowsResult = await measure("workflows", () => getBackend().listWorkflows(repoPath));
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

      const result = await measure("create", () => getBackend().create(input, repoPath));
      if (!result.ok) {
        const createStatus = backendErrorStatus(result.error);
        logApiError({ method: "POST", path: "/api/beats", status: createStatus, error: result.error?.message });
        return NextResponse.json(
          { error: result.error?.message },
          { status: createStatus },
        );
      }
      const createdBeatId = result.data!.id;
      void enqueueBeatScopeRefinement(createdBeatId, repoPath).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[scope-refinement] failed to enqueue beat ${createdBeatId}: ${message}`,
        );
      });
      return NextResponse.json({ data: result.data }, { status: 201 });
    },
  );
}
