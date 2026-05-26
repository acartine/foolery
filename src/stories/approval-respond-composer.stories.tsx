import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import {
  ApprovalRespondComposer,
} from "@/components/approval-respond-composer";
import "@/app/globals.css";

const meta = {
  title: "Components/Approvals/RespondComposer",
  component: ApprovalRespondComposer,
  parameters: { layout: "padded" },
  args: {
    approvalId: "esc_demo",
    onSubmit: fn(),
  },
} satisfies Meta<typeof ApprovalRespondComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FreeTextOnly: Story = {
  args: {
    options: [],
  },
};

export const WithFewOptions: Story = {
  args: {
    question: "How should I handle the merge conflict?",
    options: ["Take incoming", "Take current", "Abort"],
  },
};

export const WithManyOptions: Story = {
  args: {
    question: "Which rollout strategy do you want?",
    options: [
      "Ship behind a feature flag",
      "Cut a separate release branch",
      "Land it on main now",
      "Wait for the conflicts to resolve",
      "Defer to next sprint",
      "Other",
    ],
  },
};

export const Submitting: Story = {
  args: {
    options: ["Proceed", "Cancel"],
    isSubmitting: true,
  },
};

export const Disabled: Story = {
  args: {
    options: ["Proceed", "Cancel"],
    disabled: true,
  },
};
