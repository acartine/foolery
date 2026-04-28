/**
 * Regression tests for the no-implicit-fallback contract on AutoRoutingBackend.
 *
 * These tests should fail if anyone re-introduces a silent fallback to BD/CLI
 * (or any other backend) when `repoPath` is missing or unrecognised. The
 * canonical incident this guards against: prior to foolery-c751, an unrouted
 * call surfaced as `table not found: issues` instead of pointing at the real
 * config gap (no `_repo` query param, or the repo lacked a memory-manager
 * marker).
 *
 * See CLAUDE.md §"Fail Loudly, Never Silently".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockKnotsBackendCtor,
  mockBdCliBackendCtor,
  mockKnotsGet,
  mockBdGet,
  mockKnotsCapabilities,
  MockKnotsBackend,
  MockBdCliBackend,
} = vi.hoisted(() => {
  const mockKnotsBackendCtor = vi.fn();
  const mockBdCliBackendCtor = vi.fn();
  const mockKnotsGet = vi.fn();
  const mockBdGet = vi.fn();
  const mockKnotsCapabilities = {
    canCreate: true, canUpdate: true, canDelete: true, canClose: true,
    canSearch: true, canQuery: true, canListReady: true,
    canManageDependencies: true, canManageLabels: true, canSync: false,
    maxConcurrency: 1,
  };
  class MockKnotsBackend {
    capabilities = mockKnotsCapabilities;
    constructor(...args: unknown[]) { mockKnotsBackendCtor(...args); }
    get(...args: unknown[]): Promise<unknown> {
      return mockKnotsGet(...(args as []));
    }
  }
  class MockBdCliBackend {
    capabilities = mockKnotsCapabilities;
    constructor(...args: unknown[]) { mockBdCliBackendCtor(...args); }
    get(...args: unknown[]): Promise<unknown> {
      return mockBdGet(...(args as []));
    }
  }
  return {
    mockKnotsBackendCtor, mockBdCliBackendCtor,
    mockKnotsGet, mockBdGet, mockKnotsCapabilities,
    MockKnotsBackend, MockBdCliBackend,
  };
});

vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: vi.fn(() => undefined),
}));

vi.mock("@/lib/backends/knots-backend", () => ({
  KnotsBackend: MockKnotsBackend,
  KNOTS_CAPABILITIES: mockKnotsCapabilities,
}));

vi.mock("@/lib/backends/bd-cli-backend", () => ({
  BdCliBackend: MockBdCliBackend,
}));

import { AutoRoutingBackend } from "@/lib/backend-factory";
import { detectMemoryManagerType } from "@/lib/memory-manager-detection";
import {
  DispatchFailureError,
  DISPATCH_FAILURE_MARKER,
} from "@/lib/dispatch-pool-resolver";

describe("AutoRoutingBackend — no implicit fallback to BD/CLI", () => {
  let arb: AutoRoutingBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKnotsGet.mockResolvedValue({ ok: true, data: { id: "id" } });
    mockBdGet.mockResolvedValue({ ok: true, data: { id: "id" } });
    arb = new AutoRoutingBackend();
  });

  it("get() with no repoPath throws DispatchFailureError(repo_path_missing)", async () => {
    await expect(arb.get("id")).rejects.toBeInstanceOf(DispatchFailureError);
    try {
      await arb.get("id");
    } catch (err) {
      const e = err as DispatchFailureError;
      expect(e.message).toContain(DISPATCH_FAILURE_MARKER);
      expect(e.info.kind).toBe("backend");
      if (e.info.kind === "backend") {
        expect(e.info.reason).toBe("repo_path_missing");
        expect(e.info.repoPath).toBeNull();
        expect(e.info.method).toBe("get");
      }
    }
    expect(mockBdCliBackendCtor).not.toHaveBeenCalled();
    expect(mockKnotsBackendCtor).not.toHaveBeenCalled();
  });

  it("list() against an unknown repo throws DispatchFailureError(repo_type_unknown)", async () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue(undefined);
    await expect(arb.list({}, "/unknown-repo")).rejects.toBeInstanceOf(
      DispatchFailureError,
    );
    try {
      await arb.list({}, "/unknown-repo");
    } catch (err) {
      const e = err as DispatchFailureError;
      expect(e.message).toContain(DISPATCH_FAILURE_MARKER);
      expect(e.info.kind).toBe("backend");
      if (e.info.kind === "backend") {
        expect(e.info.reason).toBe("repo_type_unknown");
        expect(e.info.repoPath).toBe("/unknown-repo");
        expect(e.info.method).toBe("list");
      }
    }
    expect(mockBdCliBackendCtor).not.toHaveBeenCalled();
  });

  it("get() against a knots repo routes through KnotsBackend", async () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue("knots");
    const r = await arb.get("id", "/knots-repo");
    expect(r.ok).toBe(true);
    expect(mockKnotsBackendCtor).toHaveBeenCalledTimes(1);
    expect(mockBdCliBackendCtor).not.toHaveBeenCalled();
  });

  it("get() against a beads repo routes through BdCliBackend", async () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue("beads");
    const r = await arb.get("id", "/beads-repo");
    expect(r.ok).toBe(true);
    expect(mockBdCliBackendCtor).toHaveBeenCalledTimes(1);
    expect(mockKnotsBackendCtor).not.toHaveBeenCalled();
  });

  it("listWorkflows() with no repoPath returns builtin descriptors (no throw)", async () => {
    const r = await arb.listWorkflows();
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
    expect((r.data ?? []).length).toBeGreaterThan(0);
    expect(mockBdCliBackendCtor).not.toHaveBeenCalled();
    expect(mockKnotsBackendCtor).not.toHaveBeenCalled();
  });

  it("listWorkflows() with an unknown repoPath still throws (path was supplied)", async () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue(undefined);
    await expect(arb.listWorkflows("/unknown")).rejects.toBeInstanceOf(
      DispatchFailureError,
    );
  });

  it("banner contains FOOLERY DISPATCH FAILURE, the method name, and the repoPath", async () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue(undefined);
    try {
      await arb.create({ title: "t" } as never, "/some/repo");
    } catch (err) {
      const e = err as DispatchFailureError;
      expect(e.banner).toContain(DISPATCH_FAILURE_MARKER);
      expect(e.banner).toContain("create");
      expect(e.banner).toContain("/some/repo");
    }
  });

  it("create() with no repoPath surfaces method=create in the failure", async () => {
    try {
      await arb.create({ title: "t" } as never);
    } catch (err) {
      const e = err as DispatchFailureError;
      expect(e.info.kind).toBe("backend");
      if (e.info.kind === "backend") {
        expect(e.info.method).toBe("create");
        expect(e.info.reason).toBe("repo_path_missing");
      }
    }
  });
});
