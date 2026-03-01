import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BeadTypeBadge } from '@/components/bead-type-badge';
import type { BeatType } from '@/lib/types';
import '@/app/globals.css';

const meta = {
  title: 'Components/Badges/BeadTypeBadge',
  component: BeadTypeBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof BeadTypeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bug: Story = {
  args: {
    type: 'bug',
    showTooltip: true,
    showLabel: true,
  },
};

export const Feature: Story = {
  args: {
    type: 'feature',
    showTooltip: true,
    showLabel: true,
  },
};

export const Task: Story = {
  args: {
    type: 'task',
    showTooltip: true,
    showLabel: true,
  },
};

export const Epic: Story = {
  args: {
    type: 'epic',
    showTooltip: true,
    showLabel: true,
  },
};

export const Chore: Story = {
  args: {
    type: 'chore',
    showTooltip: true,
    showLabel: true,
  },
};

export const MergeRequest: Story = {
  args: {
    type: 'merge-request',
    showTooltip: true,
    showLabel: true,
  },
};

export const Molecule: Story = {
  args: {
    type: 'molecule',
    showTooltip: true,
    showLabel: true,
  },
};

export const Gate: Story = {
  args: {
    type: 'gate',
    showTooltip: true,
    showLabel: true,
  },
};

export const AllTypes: Story = {
  render: () => {
    const types: BeatType[] = [
      'bug',
      'feature',
      'task',
      'epic',
      'chore',
      'merge-request',
      'molecule',
      'gate',
    ];
    return (
      <div className="flex gap-4 flex-wrap">
        {types.map((type) => (
          <BeadTypeBadge key={type} type={type} showTooltip showLabel />
        ))}
      </div>
    );
  },
};

export const IconOnly: Story = {
  args: {
    type: 'feature',
    showTooltip: true,
    showLabel: false,
  },
};

export const WithoutTooltip: Story = {
  args: {
    type: 'bug',
    showTooltip: false,
    showLabel: true,
  },
};
