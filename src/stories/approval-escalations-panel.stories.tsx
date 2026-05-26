import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import {
  ApprovalEscalationsPanel,
} from "@/components/approval-escalations-panel";
import type { ScopedApproval } from "@/lib/approval-repo-scope";
import type { ApprovalAction } from "@/lib/approval-actions";
import "@/app/globals.css";

const NOW = Date.now();

const baseApproval: ScopedApproval = {
  id: "esc_demo_base",
  notificationKey: "demo",
  logicalKey: "demo",
  status: "pending",
  sessionId: "term-1779725778826-d4tjk7",
  beatId: "quilt-a808",
  beatTitle: "Brand spacing migration",
  repoPath: "/Users/cartine/quilt",
  adapter: "ask-user",
  source: "AskUserQuestion",
  question:
    "Concurrent work is in progress (an in-flight merge for knot " +
    "quilt-dd76 with 7 unresolved Rust conflicts). My brand-spacing " +
    "migration is saved on disk but I can't commit cleanly. " +
    "How should I proceed?",
  options: [],
  patterns: [],
  supportedActions: [],
  agentName: "Claude",
  agentModel: "claude-opus-4-7",
  createdAt: NOW - 13 * 60 * 60 * 1000,
  updatedAt: NOW - 13 * 60 * 60 * 1000,
  isCrossRepo: false,
};

function makeApproval(
  overrides: Partial<ScopedApproval>,
): ScopedApproval {
  return { ...baseApproval, ...overrides };
}

const meta = {
  title: "Components/Approvals/EscalationsPanel",
  component: ApprovalEscalationsPanel,
  parameters: {
    layout: "padded",
  },
  args: {
    onApprovalAction: fn(),
    onDismiss: fn(),
    onManualAction: fn(),
    onRespond: fn(),
  },
} satisfies Meta<typeof ApprovalEscalationsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Legacy / today ─────────────────────────────────────────

export const TodayUnsupportedAskUser: Story = {
  name: "Today: AskUserQuestion (no programmatic reply)",
  args: {
    approvals: [
      makeApproval({
        id: "esc_today_unsupported",
        status: "unsupported",
        supportedActions: [],
        failureReason: "approval_action_not_supported",
      }),
    ],
  },
};

export const TodayApproveReject: Story = {
  name: "Today: Approve / Reject (OpenCode permission)",
  args: {
    approvals: [
      makeApproval({
        id: "esc_today_approve_reject",
        adapter: "opencode",
        source: "permission_asked",
        toolName: "shell",
        serverName: "opencode",
        question: undefined,
        message: "Run `bun run build` to verify the type check?",
        options: [],
        supportedActions: ["approve", "always_approve", "reject"],
        replyTarget: {
          adapter: "opencode",
          transport: "http",
          nativeSessionId: "session-123",
          permissionId: "perm-456",
        },
      }),
    ],
  },
};

// ── New: Respond composer ──────────────────────────────────

const askUserSupportingRespond: Partial<ScopedApproval> = {
  supportedActions: ["respond"],
  replyTarget: {
    adapter: "claude-bridge",
    transport: "stdio",
  },
};

export const RespondFreeTextOnly: Story = {
  name: "Respond: free text only (no options)",
  args: {
    approvals: [makeApproval(askUserSupportingRespond)],
  },
};

export const RespondWithOptions: Story = {
  name: "Respond: few options + free text",
  args: {
    approvals: [
      makeApproval({
        ...askUserSupportingRespond,
        id: "esc_respond_options",
        question:
          "How should we handle the merge conflict in " +
          "`crates/quilt-brand/src/spacing.rs`?",
        options: [
          "Take incoming",
          "Take current",
          "Abort the merge",
        ],
      }),
    ],
  },
};

export const RespondManyOptions: Story = {
  name: "Respond: many options",
  args: {
    approvals: [
      makeApproval({
        ...askUserSupportingRespond,
        id: "esc_respond_many_options",
        question:
          "Which approach should I take for the brand-spacing rollout?",
        options: [
          "Ship behind a feature flag",
          "Cut a separate release branch",
          "Land it on main now",
          "Wait for the Rust conflicts to resolve",
          "Defer to the next sprint",
          "Other (see notes)",
        ],
      }),
    ],
  },
};

export const RespondSubmitting: Story = {
  name: "Respond: submitting (disabled)",
  args: {
    approvals: [
      makeApproval({
        ...askUserSupportingRespond,
        id: "esc_respond_submitting",
        status: "responding",
        options: ["Proceed", "Cancel"],
      }),
    ],
  },
};

export const RespondTerminal: Story = {
  name: "Respond: already responded (terminal)",
  args: {
    approvals: [
      makeApproval({
        ...askUserSupportingRespond,
        id: "esc_respond_terminal",
        status: "responded",
        options: ["Proceed", "Cancel"],
      }),
    ],
  },
};

export const RespondReplyFailed: Story = {
  name: "Respond: reply failed (retry banner)",
  args: {
    approvals: [
      makeApproval({
        ...askUserSupportingRespond,
        id: "esc_respond_reply_failed",
        status: "reply_failed",
        options: ["Proceed", "Cancel"],
        failureReason: "stdin_unavailable",
      }),
    ],
  },
};

export const RespondCrossRepo: Story = {
  name: "Respond: cross-repo badge",
  args: {
    approvals: [
      makeApproval({
        ...askUserSupportingRespond,
        id: "esc_respond_cross_repo",
        repoPath: "/Users/cartine/other-project",
        isCrossRepo: true,
        options: ["Yes", "No"],
      }),
    ],
  },
};

// ── Mixed list (what users will actually see) ──────────────

export const MixedList: Story = {
  name: "Mixed: respond + approve/reject + today's unsupported",
  args: {
    approvals: [
      makeApproval({
        ...askUserSupportingRespond,
        id: "esc_mixed_respond",
        options: ["Take incoming", "Take current", "Abort"],
      }),
      makeApproval({
        id: "esc_mixed_approve",
        adapter: "opencode",
        source: "permission_asked",
        toolName: "shell",
        serverName: "opencode",
        question: undefined,
        message: "Run `bun run lint --fix`?",
        options: [],
        supportedActions: ["approve", "always_approve", "reject"],
        replyTarget: {
          adapter: "opencode",
          transport: "http",
          nativeSessionId: "session-789",
          permissionId: "perm-999",
        },
      }),
      makeApproval({
        id: "esc_mixed_unsupported",
        status: "unsupported",
        supportedActions: [],
        failureReason: "approval_action_not_supported",
        question:
          "Old-style ask-user that still falls through to manual.",
      }),
    ] satisfies ScopedApproval[],
  },
};

// ── Type-check the action surface stays exhaustive ─────────

const _checkExhaustive: ApprovalAction[] = [
  "approve",
  "always_approve",
  "reject",
  "respond",
];
void _checkExhaustive;
