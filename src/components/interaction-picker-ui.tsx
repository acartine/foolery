"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { FilterDropdown } from "@/components/interaction-filter-dropdown";
import type {
  InteractionItem,
  InteractionPickerState,
} from "@/components/interaction-picker";

export function formatCompactTime(ts: string): string {
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
  return `${workflowStepLabel} · ${workflowState}`;
}

export function InteractionPicker({
  picker,
}: {
  picker: InteractionPickerState;
}) {
  const [interactionOpen, setInteractionOpen] =
    useState(false);
  const [filterOpen, setFilterOpen] =
    useState(false);
  const interactionRef = useRef<HTMLDivElement>(
    null,
  );
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!interactionOpen && !filterOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        interactionRef.current &&
        !interactionRef.current.contains(target)
      ) {
        setInteractionOpen(false);
      }
      if (
        filterRef.current &&
        !filterRef.current.contains(target)
      ) {
        setFilterOpen(false);
      }
    };
    document.addEventListener(
      "mousedown",
      handler,
    );
    return () =>
      document.removeEventListener(
        "mousedown",
        handler,
      );
  }, [interactionOpen, filterOpen]);

  const selectedLabel =
    picker.selectedInteraction
      ? (picker.interactions.find(
          (i) =>
            i.id ===
            picker.selectedInteraction,
        )?.label ?? "Select interaction")
      : "Select interaction";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#16162a] px-3 py-1.5 font-mono text-[14px] text-[#e0e0e0] subpixel-antialiased">
      <InteractionDropdown
        dropdownRef={interactionRef}
        dropdownOpen={interactionOpen}
        setDropdownOpen={setInteractionOpen}
        selectedLabel={selectedLabel}
        picker={picker}
      />

      <span className="text-white/25">|</span>

      <FilterDropdown
        dropdownRef={filterRef}
        dropdownOpen={filterOpen}
        setDropdownOpen={setFilterOpen}
        picker={picker}
      />

      <span className="text-white/25">|</span>

      <label className="inline-flex items-center gap-1.5">
        <span className="text-[13px] text-white/60">
          Detail
        </span>
        <Switch
          checked={picker.thinkingDetailVisible}
          onCheckedChange={
            picker.toggleThinkingDetail
          }
          className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-white/20"
        />
      </label>

      <span className="ml-auto text-[13px] text-white/60">
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
}: {
  dropdownRef: React.RefObject<
    HTMLDivElement | null
  >;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  selectedLabel: string;
  picker: InteractionPickerState;
}) {
  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() =>
          setDropdownOpen(!dropdownOpen)
        }
        className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2.5 py-1 text-[14px] text-[#e0e0e0] hover:bg-white/10"
      >
        <span>{selectedLabel}</span>
        <ChevronDown className="size-4" />
      </button>

      {dropdownOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-72 overflow-y-auto rounded border border-white/10 bg-[#1a1a2e] shadow-lg">
          {picker.interactions.length === 0 ? (
            <div className="px-2.5 py-2 text-[14px] text-white/70">
              No interactions found
            </div>
          ) : (
            picker.interactions.map((item) => (
              <InteractionOption
                key={item.id}
                item={item}
                isSelected={
                  picker.selectedInteraction ===
                  item.id
                }
                onSelect={() => {
                  picker.selectInteraction(
                    item.entryId,
                  );
                  setDropdownOpen(false);
                }}
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
}: {
  item: InteractionItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full px-2.5 py-2 text-left text-[14px] hover:bg-white/10 ${
        isSelected
          ? "bg-white/12 text-white"
          : "text-[#e0e0e0]"
      }`}
    >
      <span className="block text-[15px] font-medium leading-6">
        {formatConversationLabel(
          item.conversationNumber,
          item.sessionId,
          item.promptNumber,
        )}
      </span>
      <span className="block text-[13px] text-white/60">
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
