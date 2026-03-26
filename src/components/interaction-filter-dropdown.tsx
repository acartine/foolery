"use client";

import { Check, ChevronDown, Filter } from "lucide-react";
import type { InteractionPickerState } from "@/components/interaction-picker";

export function FilterDropdown({
  dropdownRef,
  dropdownOpen,
  setDropdownOpen,
  picker,
}: {
  dropdownRef: React.RefObject<
    HTMLDivElement | null
  >;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  picker: InteractionPickerState;
}) {
  const selectedCount =
    picker.messageTypeFilters.size +
    picker.workflowStepFilters.size;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() =>
          setDropdownOpen(!dropdownOpen)
        }
        className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2.5 py-1 text-[14px] text-[#e0e0e0] hover:bg-white/10"
      >
        <Filter className="size-4" />
        <span>Filters</span>
        {selectedCount > 0 ? (
          <span className="rounded bg-cyan-400/15 px-1.5 text-[12px] text-cyan-50">
            {selectedCount}
          </span>
        ) : null}
        <ChevronDown className="size-4" />
      </button>

      {dropdownOpen && (
        <FilterDropdownMenu
          picker={picker}
          selectedCount={selectedCount}
        />
      )}
    </div>
  );
}

function FilterDropdownMenu({
  picker,
  selectedCount,
}: {
  picker: InteractionPickerState;
  selectedCount: number;
}) {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded border border-white/10 bg-[#1a1a2e] shadow-lg">
      <div className="max-h-72 space-y-2 overflow-y-auto p-2">
        <section>
          <p className="px-1 text-[13px] uppercase tracking-[0.18em] text-white/45">
            Agent Message Types
          </p>
          <div className="mt-1 space-y-0.5">
            {picker.isIndexLoading ? (
              <p className="px-1 py-1 text-[13px] text-white/60">
                Loading types…
              </p>
            ) : picker.availableMessageTypes
                .length === 0 ? (
              <p className="px-1 py-1 text-[13px] text-white/60">
                No type index
              </p>
            ) : (
              picker.availableMessageTypes.map(
                (type) => (
                  <FilterOptionRow
                    key={type}
                    selected={picker.messageTypeFilters.has(
                      type,
                    )}
                    label={type}
                    onToggle={() =>
                      picker.toggleTypeFilter(
                        type,
                      )
                    }
                  />
                ),
              )
            )}
          </div>
        </section>

        <section>
          <p className="px-1 text-[13px] uppercase tracking-[0.18em] text-white/45">
            Workflow Steps (queue/action)
          </p>
          <div className="mt-1 space-y-0.5">
            {picker.availableWorkflowStepFilters.map(
              (step) => (
                <FilterOptionRow
                  key={step.id}
                  selected={picker.workflowStepFilters.has(
                    step.id,
                  )}
                  label={step.label}
                  description={`${step.states[0]} / ${step.states[1]}`}
                  onToggle={() =>
                    picker.toggleWorkflowStepFilter(
                      step.id,
                    )
                  }
                />
              ),
            )}
          </div>
        </section>
      </div>
      <FilterDropdownFooter
        selectedCount={selectedCount}
        clearFilters={picker.clearFilters}
      />
    </div>
  );
}

function FilterDropdownFooter({
  selectedCount,
  clearFilters,
}: {
  selectedCount: number;
  clearFilters: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-white/10 bg-[#16162a] px-2.5 py-1.5">
      <span className="text-[13px] text-white/60">
        {selectedCount === 0
          ? "No filters selected"
          : `${selectedCount} active filter${selectedCount === 1 ? "" : "s"}`}
      </span>
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className="text-[13px] text-white/75 hover:text-white"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}

function FilterOptionRow({
  selected,
  label,
  description,
  onToggle,
}: {
  selected: boolean;
  label: string;
  description?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left hover:bg-white/10"
    >
      <span
        className={`mt-[1px] inline-flex size-4 shrink-0 items-center justify-center rounded border ${
          selected
            ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100"
            : "border-white/20 text-transparent"
        }`}
      >
        <Check className="size-2.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] leading-6 text-[#e0e0e0]">
          {label}
        </span>
        {description ? (
          <span className="block truncate text-[13px] text-white/60">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
