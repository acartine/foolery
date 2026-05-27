"use client";

import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface VerificationStepsEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

type SetInputRef = (index: number, node: HTMLInputElement | null) => void;

export function VerificationStepsEditor({
  value,
  onChange,
  disabled = false,
}: VerificationStepsEditorProps) {
  const [draft, setDraft] = useState("");
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const setInputRef = useCallback<SetInputRef>((index, node) => {
    inputRefs.current[index] = node;
  }, []);

  const requestFocus = useCallback((index: number) => {
    const targetIndex = Math.max(0, index);
    queueMicrotask(() => {
      inputRefs.current[targetIndex]?.focus();
    });
  }, []);

  const updateStep = useCallback(
    (index: number, step: string) => {
      const next = [...value];
      next[index] = step;
      onChange(next);
    },
    [onChange, value],
  );

  const removeStep = useCallback(
    (index: number) => {
      const next = value.filter((_, idx) => idx !== index);
      onChange(next);
      requestFocus(Math.min(Math.max(index - 1, 0), next.length));
    },
    [onChange, requestFocus, value],
  );

  const commitDraft = useCallback(() => {
    const normalized = draft.trim();
    if (!normalized) return false;
    onChange([...value, normalized]);
    setDraft("");
    requestFocus(value.length + 1);
    return true;
  }, [draft, onChange, requestFocus, value]);

  const handleStepKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLInputElement>,
      index: number,
    ) => {
      if (event.key === "Enter" || event.key === "ArrowDown") {
        event.preventDefault();
        requestFocus(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        requestFocus(index - 1);
      } else if (
        (event.key === "Backspace" || event.key === "Delete") &&
        event.currentTarget.value.length === 0
      ) {
        event.preventDefault();
        removeStep(index);
      }
    },
    [removeStep, requestFocus],
  );

  const handleDraftKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitDraft();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        requestFocus(value.length - 1);
      }
    },
    [commitDraft, requestFocus, value.length],
  );

  return (
    <div className="space-y-1">
      {value.map((step, index) => (
        <VerificationStepRow
          key={`verification-step-${index}`}
          disabled={disabled}
          index={index}
          onKeyDown={handleStepKeyDown}
          onRemove={removeStep}
          onUpdate={updateStep}
          setInputRef={setInputRef}
          step={step}
        />
      ))}
      <VerificationDraftInput
        disabled={disabled}
        draft={draft}
        onChangeDraft={setDraft}
        onCommit={commitDraft}
        onKeyDown={handleDraftKeyDown}
        setInputRef={setInputRef}
        stepCount={value.length}
      />
    </div>
  );
}

interface VerificationStepRowProps {
  disabled: boolean;
  index: number;
  onKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, step: string) => void;
  setInputRef: SetInputRef;
  step: string;
}

function VerificationStepRow({
  disabled,
  index,
  onKeyDown,
  onRemove,
  onUpdate,
  setInputRef,
  step,
}: VerificationStepRowProps) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Input
        ref={(node) => {
          setInputRef(index, node);
        }}
        value={step}
        disabled={disabled}
        placeholder={`Step ${index + 1}`}
        onChange={(event) =>
          onUpdate(index, event.target.value)
        }
        onBlur={(event) => {
          const normalized = event.target.value.trim();
          if (normalized !== event.target.value) {
            onUpdate(index, normalized);
          }
        }}
        onKeyDown={(event) => onKeyDown(event, index)}
      />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        title="Delete verification step"
        aria-label="Delete verification step"
        disabled={disabled}
        onClick={() => onRemove(index)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

interface VerificationDraftInputProps {
  disabled: boolean;
  draft: string;
  onChangeDraft: (draft: string) => void;
  onCommit: () => boolean;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  setInputRef: SetInputRef;
  stepCount: number;
}

function VerificationDraftInput({
  disabled,
  draft,
  onChangeDraft,
  onCommit,
  onKeyDown,
  setInputRef,
  stepCount,
}: VerificationDraftInputProps) {
  return (
    <Input
      ref={(node) => {
        setInputRef(stepCount, node);
      }}
      value={draft}
      disabled={disabled}
      placeholder={
        stepCount > 0
          ? "Add another verification step"
          : "Add verification step"
      }
      onChange={(event) => onChangeDraft(event.target.value)}
      onBlur={() => {
        onCommit();
      }}
      onKeyDown={onKeyDown}
    />
  );
}
