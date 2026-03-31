"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { FilterDropdown } from
  "@/components/interaction-filter-dropdown";
import type {
  InteractionItem,
  InteractionPickerState,
} from "@/components/interaction-picker";
import type {
  ConversationLogTheme,
} from "@/components/agent-history-conversation-log-theme";

export function formatCompactTime(
  ts: string,
): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatCompactDate(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatConversationLabel(
  conversationNumber: number,
  sessionId: string,
  promptNumber: number,
): string {
  return `#${conversationNumber} ${sessionId} · Prompt #${promptNumber}`;
}

function promptStateMeta(
  workflowState?: string,
  workflowStepLabel?: string,
): string {
  if (!workflowState) return "State unknown";
  if (!workflowStepLabel) return workflowState;
  return (
    `${workflowStepLabel} · ${workflowState}`
  );
}

function useClickOutside(
  refs: React.RefObject<HTMLDivElement | null>[],
  closers: (() => void)[],
  anyOpen: boolean,
) {
  useEffect(() => {
    if (!anyOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      refs.forEach((ref, i) => {
        if (ref.current && !ref.current.contains(t))
          closers[i]();
      });
    };
    document.addEventListener("mousedown", handler);
    return () =>
      document.removeEventListener("mousedown", handler);
  });
}

export function InteractionPicker({
  picker,
  theme,
}: {
  picker: InteractionPickerState;
  theme: ConversationLogTheme;
}) {
  const [interactionOpen, setInteractionOpen] =
    useState(false);
  const [filterOpen, setFilterOpen] =
    useState(false);
  const interactionRef =
    useRef<HTMLDivElement>(null);
  const filterRef =
    useRef<HTMLDivElement>(null);

  useClickOutside(
    [interactionRef, filterRef],
    [
      () => setInteractionOpen(false),
      () => setFilterOpen(false),
    ],
    interactionOpen || filterOpen,
  );

  const selectedLabel =
    picker.selectedInteraction
      ? (picker.interactions.find(
          (i) =>
            i.id
            === picker.selectedInteraction,
        )?.label ?? "Select interaction")
      : "Select interaction";

  return (
    <div className={theme.pickerBar}>
      <InteractionDropdown
        dropdownRef={interactionRef}
        dropdownOpen={interactionOpen}
        setDropdownOpen={setInteractionOpen}
        selectedLabel={selectedLabel}
        picker={picker}
        theme={theme}
      />

      <span className={theme.pickerSeparator}>
        |
      </span>

      <FilterDropdown
        dropdownRef={filterRef}
        dropdownOpen={filterOpen}
        setDropdownOpen={setFilterOpen}
        picker={picker}
        theme={theme}
      />

      <span className={theme.pickerSeparator}>
        |
      </span>

      <label className={
        "inline-flex items-center gap-1.5"
      }>
        <span className={
          "text-[13px] "
          + theme.pickerDetailLabel
        }>
          Detail
        </span>
        <Switch
          checked={
            picker.thinkingDetailVisible
          }
          onCheckedChange={
            picker.toggleThinkingDetail
          }
          className={theme.pickerDetailSwitch}
        />
      </label>

      <span className={
        "ml-auto text-[13px] "
        + theme.pickerCount
      }>
        {picker.interactions.length} interaction
        {picker.interactions.length === 1
          ? ""
          : "s"}
      </span>
    </div>
  );
}

function InteractionDropdown({
  dropdownRef,
  dropdownOpen,
  setDropdownOpen,
  selectedLabel,
  picker,
  theme,
}: {
  dropdownRef: React.RefObject<
    HTMLDivElement | null
  >;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  selectedLabel: string;
  picker: InteractionPickerState;
  theme: ConversationLogTheme;
}) {
  return (
    <div
      ref={dropdownRef}
      className="relative"
    >
      <button
        type="button"
        onClick={() =>
          setDropdownOpen(!dropdownOpen)
        }
        className={theme.pickerDropdownButton}
      >
        <span>{selectedLabel}</span>
        <ChevronDown className="size-4" />
      </button>

      {dropdownOpen && (
        <div className={
          theme.pickerDropdownPanel
        }>
          {picker.interactions.length === 0 ? (
            <div className={
              "px-2.5 py-2 text-[14px] "
              + theme.pickerNoItems
            }>
              No interactions found
            </div>
          ) : (
            picker.interactions.map((item) => (
              <InteractionOption
                key={item.id}
                item={item}
                isSelected={
                  picker.selectedInteraction
                  === item.id
                }
                onSelect={() => {
                  picker.selectInteraction(
                    item.entryId,
                  );
                  setDropdownOpen(false);
                }}
                theme={theme}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function InteractionOption({
  item,
  isSelected,
  onSelect,
  theme,
}: {
  item: InteractionItem;
  isSelected: boolean;
  onSelect: () => void;
  theme: ConversationLogTheme;
}) {
  const optionClass = isSelected
    ? theme.pickerOptionSelected
    : theme.pickerOptionDefault;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "block w-full px-2.5 py-2"
        + " text-left text-[14px] "
        + theme.filterOptionHover
        + " " + optionClass
      }
    >
      <span className={
        "block text-[15px]"
        + " font-medium leading-6"
      }>
        {formatConversationLabel(
          item.conversationNumber,
          item.sessionId,
          item.promptNumber,
        )}
      </span>
      <span className={
        "block text-[13px] "
        + theme.pickerOptionMeta
      }>
        {promptStateMeta(
          item.workflowState,
          item.workflowStepLabel,
        )}
        {" · "}
        {formatCompactDate(item.timestamp)}
        {" · "}
        {formatCompactTime(item.timestamp)}
      </span>
    </button>
  );
}
