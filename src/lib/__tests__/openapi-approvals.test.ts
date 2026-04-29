/**
 * OpenAPI snapshot for the canonical Approval Escalation API surface.
 */
import { describe, expect, it } from "vitest";
import { openApiSpec } from "@/lib/openapi-spec";

const paths = openApiSpec.paths as Record<string, unknown>;
const schemas = openApiSpec.components.schemas as Record<
  string,
  unknown
>;

describe("openApiSpec: approvals paths", () => {
  it("documents GET /api/approvals", () => {
    const route = paths["/api/approvals"] as {
      get?: { parameters?: { name: string }[] };
    } | undefined;
    expect(route?.get).toBeDefined();
    const paramNames = (route?.get?.parameters ?? [])
      .map((p) => p.name);
    expect(paramNames).toContain("_repo");
    expect(paramNames).toContain("active");
    expect(paramNames).toContain("status");
    expect(paramNames).toContain("updatedSince");
  });

  it("documents POST /api/approvals/{approvalId}/actions", () => {
    const route =
      paths["/api/approvals/{approvalId}/actions"] as {
        post?: Record<string, unknown>;
      } | undefined;
    expect(route?.post).toBeDefined();
  });

  it("retains the session-scoped compat route", () => {
    const route = paths[
      "/api/terminal/{sessionId}/approvals/{approvalId}"
    ] as { post?: Record<string, unknown> } | undefined;
    expect(route?.post).toBeDefined();
  });
});

describe("openApiSpec: approvals schemas", () => {
  it("registers the ApprovalEscalation schema", () => {
    expect(schemas.ApprovalEscalation).toBeDefined();
    expect(schemas.ApprovalAction).toBeDefined();
    expect(schemas.ApprovalEscalationStatus).toBeDefined();
    expect(schemas.ApprovalReplyTarget).toBeDefined();
    expect(schemas.ApprovalAgentInfo).toBeDefined();
    expect(schemas.ApprovalActionRequest).toBeDefined();
    expect(schemas.ApprovalActionResponse).toBeDefined();
    expect(schemas.ApprovalActionErrorResponse).toBeDefined();
  });

  it("attaches pendingApprovals to TerminalSession", () => {
    const terminalSession = schemas.TerminalSession as {
      properties: Record<string, unknown>;
    };
    const pending = terminalSession.properties.pendingApprovals as
      { type?: string; items?: { $ref?: string } } | undefined;
    expect(pending).toBeDefined();
    expect(pending?.type).toBe("array");
    expect(pending?.items?.$ref).toContain(
      "ApprovalEscalation",
    );
  });
});
