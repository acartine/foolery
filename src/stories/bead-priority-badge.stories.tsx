import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BeadPriorityBadge } from '@/components/bead-priority-badge';
import type { BeadPriority } from '@/lib/types';
import '@/app/globals.css';

const meta = {
  title: 'Components/Badges/BeadPriorityBadge',
  component: BeadPriorityBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof BeadPriorityBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Critical: Story = {
  args: {
    priority: 0,
    showTooltip: true,
    showLabel: true,
  },
};

export const High: Story = {
  args: {
    priority: 1,
    showTooltip: true,
    showLabel: true,
  },
};

export const Medium: Story = {
  args: {
    priority: 2,
    showTooltip: true,
    showLabel: true,
  },
};

export const Low: Story = {
  args: {
    priority: 3,
    showTooltip: true,
    showLabel: true,
  },
};

export const Trivial: Story = {
  args: {
    priority: 4,
    showTooltip: true,
    showLabel: true,
  },
};

export const AllPriorities: Story = {
  render: () => {
    const priorities: BeadPriority[] = [0, 1, 2, 3, 4];
    return (
      <div className="flex gap-4 flex-wrap">
        {priorities.map((priority) => (
          <BeadPriorityBadge
            key={priority}
            priority={priority}
            showTooltip
            showLabel
          />
        ))}
      </div>
    );
  },
};

export const IconOnly: Story = {
  args: {
    priority: 0,
    showTooltip: true,
    showLabel: false,
  },
};

export const WithoutTooltip: Story = {
  args: {
    priority: 1,
    showTooltip: false,
    showLabel: true,
  },
};
