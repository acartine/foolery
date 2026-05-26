"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ApprovalRespondComposerProps {
  approvalId: string;
  question?: string;
  options: string[];
  disabled?: boolean;
  isSubmitting?: boolean;
  onSubmit: (approvalId: string, text: string) => void;
}

export function ApprovalRespondComposer(
  props: ApprovalRespondComposerProps,
) {
  const { options, disabled, isSubmitting, onSubmit, approvalId } =
    props;
  const [text, setText] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(
    null,
  );

  const trimmed = text.trim();
  const canSubmit =
    !disabled && !isSubmitting && (trimmed.length > 0 || !!selectedOption);

  const handleOptionClick = (option: string) => {
    if (disabled || isSubmitting) return;
    if (selectedOption === option) {
      setSelectedOption(null);
      return;
    }
    setSelectedOption(option);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const payload = composeResponseText({
      option: selectedOption,
      freeText: trimmed,
    });
    onSubmit(approvalId, payload);
  };

  return (
    <div
      className="mt-3 rounded-md border bg-muted/30 p-3"
      data-testid="approval-respond-composer"
      data-approval-id={approvalId}
    >
      {options.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {options.map((option) => {
            const active = selectedOption === option;
            return (
              <button
                type="button"
                key={option}
                disabled={disabled || isSubmitting}
                onClick={() => handleOptionClick(option)}
                data-approval-option={option}
                data-active={active ? "true" : "false"}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs " +
                    "transition-colors disabled:opacity-50",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-muted",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : null}
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          options.length > 0
            ? "Add notes, or pick an option above. Free text overrides."
            : "Type your response..."
        }
        disabled={disabled || isSubmitting}
        rows={3}
        data-testid="approval-respond-textarea"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {selectedOption
            ? `Sending "${selectedOption}"` +
              (trimmed.length > 0 ? " with your notes." : ".")
            : trimmed.length > 0
              ? "Sending your free-text response."
              : "Pick an option or type a response."}
        </p>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
          data-approval-action="respond"
        >
          <Send className="size-4" />
          {isSubmitting ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}

interface ComposeInput {
  option: string | null;
  freeText: string;
}

export function composeResponseText(input: ComposeInput): string {
  const { option, freeText } = input;
  if (option && freeText) return `${option}\n\n${freeText}`;
  if (option) return option;
  return freeText;
}
