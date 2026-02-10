import type { Meta, StoryObj } from '@storybook/react';
import { BeadForm } from '@/components/bead-form';
import type { Bead, CreateBeadInput } from '@/lib/types';
import '@/app/globals.css';

const meta = {
  title: 'Components/BeadForm',
  component: BeadForm,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof BeadForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockBead: Bead = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Fix login redirect issue',
  description: 'Users are being redirected to the wrong page after login',
  acceptance: '- Login page loads\n- User enters credentials\n- User is redirected to dashboard',
  type: 'bug',
  status: 'open',
  priority: 0,
  labels: ['frontend', 'auth'],
  assignee: 'alice',
  owner: 'bob',
  due: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  estimate: 4,
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
};

const mockSubmit = async (data: CreateBeadInput) => {
  console.log('Form submitted:', data);
  await new Promise((resolve) => setTimeout(resolve, 500));
};

export const Create: Story = {
  args: {
    onSubmit: mockSubmit,
    isLoading: false,
  },
};

export const Edit: Story = {
  args: {
    bead: mockBead,
    onSubmit: mockSubmit,
    isLoading: false,
    onCancel: () => console.log('Cancelled'),
  },
};

export const Loading: Story = {
  args: {
    onSubmit: mockSubmit,
    isLoading: true,
  },
};

export const WithCancel: Story = {
  args: {
    onSubmit: mockSubmit,
    isLoading: false,
    onCancel: () => console.log('Form cancelled'),
  },
};

export const FilledForm: Story = {
  args: {
    bead: {
      ...mockBead,
      title: 'Implement user profile page',
      description: 'Create a new page where users can view and edit their profile information',
      type: 'feature',
      status: 'in_progress',
      priority: 1,
      labels: ['frontend', 'ui', 'user-management'],
      assignee: 'charlie',
    },
    onSubmit: mockSubmit,
    isLoading: false,
    onCancel: () => console.log('Cancelled'),
  },
};
