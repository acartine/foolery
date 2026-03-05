import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BeatStatusBadge } from '@/components/beat-status-badge';
// BeatStatus is now a string type; keep array typed inline
import '@/app/globals.css';

const meta = {
  title: 'Components/Badges/BeatStatusBadge',
  component: BeatStatusBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof BeatStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    status: 'open',
    showTooltip: true,
  },
};

export const InProgress: Story = {
  args: {
    status: 'in_progress',
    showTooltip: true,
  },
};

export const Blocked: Story = {
  args: {
    status: 'blocked',
    showTooltip: true,
  },
};

export const Deferred: Story = {
  args: {
    status: 'deferred',
    showTooltip: true,
  },
};

export const Closed: Story = {
  args: {
    status: 'closed',
    showTooltip: true,
  },
};

export const AllStatuses: Story = {
  render: () => {
    const statuses = ['open', 'in_progress', 'blocked', 'deferred', 'closed'];
    return (
      <div className="flex gap-4 flex-wrap">
        {statuses.map((status) => (
          <BeatStatusBadge key={status} status={status} showTooltip />
        ))}
      </div>
    );
  },
};

export const WithoutTooltip: Story = {
  args: {
    status: 'open',
    showTooltip: false,
  },
};
