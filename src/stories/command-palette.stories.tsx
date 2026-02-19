import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CommandPalette } from '@/components/command-palette';
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

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: (open) => console.log('Open:', open),
  },
};

export const Closed: Story = {
  args: {
    open: false,
    onOpenChange: (open) => console.log('Open:', open),
  },
};

export const Empty: Story = {
  args: {
    open: true,
    onOpenChange: (open) => console.log('Open:', open),
  },
};

export const ManyBeads: Story = {
  args: {
    open: true,
    onOpenChange: (open) => console.log('Open:', open),
  },
};
