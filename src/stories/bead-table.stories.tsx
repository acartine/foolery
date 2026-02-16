import type { Meta, StoryObj } from '@storybook/react';
import { BeadTable } from '@/components/bead-table';
import type { Bead } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/app/globals.css';

const queryClient = new QueryClient();

const meta = {
  title: 'Components/BeadTable',
  component: BeadTable,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof BeadTable>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockBeads: Bead[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Fix login redirect issue',
    description: 'Users are being redirected to the wrong page after login',
    type: 'bug',
    status: 'open',
    priority: 0,
    labels: ['frontend', 'auth'],
    assignee: 'alice',
    owner: 'bob',
    created: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    title: 'Implement user profile page',
    description: 'Create a new page for users to view and edit their profile',
    type: 'feature',
    status: 'in_progress',
    priority: 1,
    labels: ['frontend', 'ui'],
    assignee: 'charlie',
    owner: 'bob',
    created: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    due: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    title: 'Optimize database queries',
    description: 'Review and optimize slow database queries',
    type: 'task',
    status: 'blocked',
    priority: 2,
    labels: ['backend', 'performance'],
    assignee: undefined,
    owner: 'bob',
    created: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    title: 'Update documentation',
    description: 'Update API documentation to reflect new endpoints',
    type: 'chore',
    status: 'deferred',
    priority: 3,
    labels: ['docs'],
    assignee: 'dave',
    owner: 'bob',
    created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    title: 'Release v2.0',
    description: 'Prepare and release version 2.0',
    type: 'epic',
    status: 'closed',
    priority: 0,
    labels: ['release'],
    assignee: 'eve',
    owner: 'bob',
    created: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    closed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const Default: Story = {
  args: {
    data: mockBeads,
  },
};

export const Loading: Story = {
  args: {
    data: [],
  },
};

export const Empty: Story = {
  args: {
    data: [],
  },
};

export const SingleBead: Story = {
  args: {
    data: [mockBeads[0]],
  },
};

export const WithSelection: Story = {
  args: {
    data: mockBeads,
    onSelectionChange: (ids) => console.log('Selected:', ids),
  },
};
