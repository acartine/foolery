"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_LABELS_VALUE = "__foolery_all_labels__";
const LABEL_VALUE_PREFIX = "label:";

interface QueueLabelFilterSelectProps {
  options: readonly string[];
  selectedLabel: string | null;
  onChange: (label: string | null) => void;
}

export function QueueLabelFilterSelect({
  options,
  selectedLabel,
  onChange,
}: QueueLabelFilterSelectProps) {
  const hasOptions = options.length > 0;

  return (
    <Select
      value={selectedLabel
        ? queueLabelOptionValue(selectedLabel)
        : ALL_LABELS_VALUE}
      disabled={!hasOptions}
      onValueChange={(value) =>
        onChange(queueLabelFromOptionValue(value))
      }
    >
      <SelectTrigger
        aria-label="Filter queues by label"
        className="h-7 w-[190px] shrink-0"
        data-testid="queue-label-filter"
      >
        <SelectValue placeholder={hasOptions ? "Label" : "No labels"} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={ALL_LABELS_VALUE}>
          {hasOptions ? "All Labels" : "No labels"}
        </SelectItem>
        {options.map((label) => (
          <SelectItem key={label} value={queueLabelOptionValue(label)}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function queueLabelOptionValue(label: string): string {
  return `${LABEL_VALUE_PREFIX}${label}`;
}

function queueLabelFromOptionValue(value: string): string | null {
  if (value === ALL_LABELS_VALUE) return null;
  return value.startsWith(LABEL_VALUE_PREFIX)
    ? value.slice(LABEL_VALUE_PREFIX.length)
    : null;
}
