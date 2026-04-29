import type {
  ApprovalAction,
  ApprovalReplyResult,
} from "@/lib/approval-actions";

export interface OpenCodeApprovalReplyRequest {
  baseUrl: string | null;
  nativeSessionId: string | null | undefined;
  permissionId: string | null | undefined;
  action: ApprovalAction;
  fetcher?: typeof fetch;
}

const APPROVAL_REPLY_TIMEOUT_MS = 1_500;

function responseForAction(
  action: ApprovalAction,
): string {
  switch (action) {
    case "approve":
      return "once";
    case "always_approve":
      return "always";
    case "reject":
      return "reject";
  }
}

export async function respondToOpenCodeApproval(
  request: OpenCodeApprovalReplyRequest,
): Promise<ApprovalReplyResult> {
  const {
    baseUrl,
    nativeSessionId,
    permissionId,
    action,
    fetcher = fetch,
  } = request;
  if (!baseUrl || !nativeSessionId || !permissionId) {
    return {
      ok: false,
      status: "unsupported",
      reason: "missing_opencode_reply_target",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, APPROVAL_REPLY_TIMEOUT_MS);
  try {
    const resp = await fetcher(
      `${baseUrl}/session/${nativeSessionId}` +
        `/permissions/${permissionId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          response: responseForAction(action),
          remember: action === "always_approve",
        }),
      },
    );
    if (!resp.ok) {
      return {
        ok: false,
        reason: `opencode_http_${resp.status}`,
      };
    }
    const body = await readJson(resp);
    return body === false
      ? { ok: false, reason: "opencode_returned_false" }
      : { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error
        ? err.message
        : "opencode_reply_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(
  resp: Response,
): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}
