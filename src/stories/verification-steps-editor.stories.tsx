import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  VerificationStepsEditor,
} from "@/components/verification-steps-editor";
import "@/app/globals.css";

interface HarnessProps {
  initialSteps: string[];
  disabled?: boolean;
}

function VerificationStepsHarness({
  initialSteps,
  disabled = false,
}: HarnessProps) {
  const [steps, setSteps] = useState(initialSteps);
  return (
    <div className="max-w-lg p-4">
      <VerificationStepsEditor
        value={steps}
        onChange={setSteps}
        disabled={disabled}
      />
      <output data-testid="steps-output">
        {steps.join("|")}
      </output>
    </div>
  );
}

const meta = {
  title: "Components/VerificationStepsEditor",
  component: VerificationStepsHarness,
  tags: ["autodocs"],
} satisfies Meta<typeof VerificationStepsHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    initialSteps: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText("Add verification step");
    await userEvent.click(input);
    await userEvent.type(input, "Run lint{enter}");
    await expect(canvas.findByDisplayValue("Run lint")).resolves.toBeTruthy();
    expect(canvas.getByTestId("steps-output").textContent).toBe("Run lint");
  },
};

export const Populated: Story = {
  args: {
    initialSteps: ["Run lint", "Run tests"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const inputs = canvas.getAllByRole("textbox");
    await userEvent.click(inputs[0]);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(inputs[1]);
    await userEvent.clear(inputs[1]);
    await userEvent.keyboard("{Backspace}");
    await waitFor(() => {
      expect(canvas.queryByDisplayValue("Run tests")).toBeNull();
      expect(canvas.getByTestId("steps-output").textContent).toBe("Run lint");
    });
  },
};

export const Disabled: Story = {
  args: {
    initialSteps: ["Run lint"],
    disabled: true,
  },
};
