import type { Meta, StoryObj } from '@storybook/react';
import { CommandPalette } from '@/components/command-palette';
import type { Bead, BeadPriority } from '@/lib/types';
import '@/app/globals.css';

const meta = {
  title: 'Components/CommandPalette',
  component: CommandPalette,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockBeads: Bead[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Fix login redirect issue',
    type: 'bug',
    status: 'open',
    priority: 0,
    labels: ['frontend'],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    title: 'Implement user profile page',
    type: 'feature',
    status: 'in_progress',
    priority: 1,
    labels: ['frontend', 'ui'],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    title: 'Optimize database queries',
    type: 'task',
    status: 'open',
    priority: 2,
    labels: ['backend'],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
] as const;

export const Default: Story = {
  args: {
    beads: mockBeads,
    isOpen: true,
    onOpenChange: (open) => console.log('Open:', open),
    onSelectBead: (bead) => console.log('Selected:', bead.id),
    onCreateBead: () => console.log('Create new bead'),
  },
};

export const Closed: Story = {
  args: {
    beads: mockBeads,
    isOpen: false,
    onOpenChange: (open) => console.log('Open:', open),
    onSelectBead: (bead) => console.log('Selected:', bead.id),
    onCreateBead: () => console.log('Create new bead'),
  },
};

export const Empty: Story = {
  args: {
    beads: [],
    isOpen: true,
    onOpenChange: (open) => console.log('Open:', open),
    onSelectBead: (bead) => console.log('Selected:', bead.id),
    onCreateBead: () => console.log('Create new bead'),
  },
};

export const ManyBeads: Story = {
  args: {
    beads: Array.from({ length: 50 }, (_, i) => ({
      id: `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`,
      title: `Task ${i + 1}`,
      type: 'task' as const,
      status: i % 2 === 0 ? ('open' as const) : ('in_progress' as const),
      priority: (i % 5) as BeadPriority,
      labels: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    })),
    isOpen: true,
    onOpenChange: (open) => console.log('Open:', open),
    onSelectBead: (bead) => console.log('Selected:', bead.id),
    onCreateBead: () => console.log('Create new bead'),
  },
};
