import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, userEvent, within } from "storybook/test";
import {
  StaleBeatGroomingDialog,
} from "@/components/stale-beat-grooming-dialog";
import type { Beat } from "@/lib/types";
import "@/app/globals.css";

const staleBeat: Beat = {
  id: "stale-beat-1",
  title: "Revive stale overview trigger",
  description: "Dialog trigger regression fixture",
  type: "work",
  state: "implementation",
  priority: 1,
  labels: [],
  created: "2024-01-01T00:00:00.000Z",
  updated: "2024-01-02T00:00:00.000Z",
};

const meta = {
  title: "Components/StaleBeatGroomingDialog",
  component: StaleBeatGroomingDialog,
  parameters: {
    layout: "centered",
  },
  args: {
    beats: [staleBeat],
    isAllRepositories: false,
    onOpenBeat: () => undefined,
  },
  render: (args) => (
    <QueryClientProvider client={storyQueryClient()}>
      <StaleBeatGroomingDialog {...args} />
    </QueryClientProvider>
  ),
  tags: ["autodocs"],
} satisfies Meta<typeof StaleBeatGroomingDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TriggerOpensDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    await userEvent.click(canvas.getByTestId("stale-beats-dialog-trigger"));

    await expect(
      await body.findByTestId("stale-beat-grooming-dialog"),
    ).toBeVisible();
  },
};

function storyQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });
  client.setQueryData(["stale-beat-grooming", "reviews"], {
    ok: true,
    data: [],
  });
  client.setQueryData(["stale-beat-grooming", "options"], {
    ok: true,
    data: {
      agents: [
        {
          id: "codex",
          label: "Codex",
          model: "gpt-5",
        },
      ],
      defaultAgentId: "codex",
    },
  });
  return client;
}
