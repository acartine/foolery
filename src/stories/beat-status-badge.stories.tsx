import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BeatStateBadge } from '@/components/beat-state-badge';
import '@/app/globals.css';

const meta = {
  title: 'Components/Badges/BeatStateBadge',
  component: BeatStateBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof BeatStateBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyForImplementation: Story = {
  args: {
    state: 'ready_for_implementation',
  },
};

export const Implementation: Story = {
  args: {
    state: 'implementation',
  },
};

export const Shipped: Story = {
  args: {
    state: 'shipped',
  },
};

export const Blocked: Story = {
  args: {
    state: 'blocked',
  },
};

export const Deferred: Story = {
  args: {
    state: 'deferred',
  },
};

export const Closed: Story = {
  args: {
    state: 'closed',
  },
};

export const AllStates: Story = {
  render: () => {
    const states = [
      'ready_for_planning',
      'planning',
      'ready_for_plan_review',
      'plan_review',
      'ready_for_implementation',
      'implementation',
      'ready_for_implementation_review',
      'implementation_review',
      'ready_for_shipment',
      'shipment',
      'ready_for_shipment_review',
      'shipment_review',
      'shipped',
      'abandoned',
      'closed',
      'blocked',
      'deferred',
    ];
    return (
      <div className="flex gap-4 flex-wrap">
        {states.map((state) => (
          <BeatStateBadge key={state} state={state} />
        ))}
      </div>
    );
  },
};
