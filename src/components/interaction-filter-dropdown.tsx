"use client";

import {
  Check,
  ChevronDown,
  Filter,
} from "lucide-react";
import type {
  InteractionPickerState,
} from "@/components/interaction-picker";
import type {
  ConversationLogTheme,
} from "@/components/agent-history-conversation-log-theme";

export function FilterDropdown({
  dropdownRef,
  dropdownOpen,
  setDropdownOpen,
  picker,
  theme,
}: {
  dropdownRef: React.RefObject<
    HTMLDivElement | null
  >;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  picker: InteractionPickerState;
  theme: ConversationLogTheme;
}) {
  const selectedCount =
    picker.messageTypeFilters.size
    + picker.workflowStepFilters.size;

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
        className={theme.filterButton}
      >
        <Filter className="size-4" />
        <span>Filters</span>
        {selectedCount > 0 ? (
          <span className={
            theme.filterBadgeCount
          }>
            {selectedCount}
          </span>
        ) : null}
        <ChevronDown className="size-4" />
      </button>

      {dropdownOpen && (
        <FilterDropdownMenu
          picker={picker}
          selectedCount={selectedCount}
          theme={theme}
        />
      )}
    </div>
  );
}

function FilterDropdownMenu({
  picker,
  selectedCount,
  theme,
}: {
  picker: InteractionPickerState;
  selectedCount: number;
  theme: ConversationLogTheme;
}) {
  return (
    <div className={theme.filterPanel}>
      <div className={
        "max-h-72 space-y-2"
        + " overflow-y-auto p-2"
      }>
        <section>
          <p className={theme.filterSectionLabel}>
            Agent Message Types
          </p>
          <div className="mt-1 space-y-0.5">
            {picker.isIndexLoading ? (
              <p className={
                "px-1 py-1 text-[13px] "
                + theme.filterLoadingText
              }>
                Loading types…
              </p>
            ) : picker.availableMessageTypes
                .length === 0 ? (
              <p className={
                "px-1 py-1 text-[13px] "
                + theme.filterLoadingText
              }>
                No type index
              </p>
            ) : (
              picker.availableMessageTypes.map(
                (type) => (
                  <FilterOptionRow
                    key={type}
                    selected={
                      picker
                        .messageTypeFilters
                        .has(type)
                    }
                    label={type}
                    onToggle={() =>
                      picker.toggleTypeFilter(
                        type,
                      )
                    }
                    theme={theme}
                  />
                ),
              )
            )}
          </div>
        </section>

        <section>
          <p className={theme.filterSectionLabel}>
            Workflow Steps (queue/action)
          </p>
          <div className="mt-1 space-y-0.5">
            {picker.availableWorkflowStepFilters
              .map((step) => (
                <FilterOptionRow
                  key={step.id}
                  selected={
                    picker
                      .workflowStepFilters
                      .has(step.id)
                  }
                  label={step.label}
                  description={
                    `${step.states[0]}`
                    + ` / ${step.states[1]}`
                  }
                  onToggle={() =>
                    picker
                      .toggleWorkflowStepFilter(
                        step.id,
                      )
                  }
                  theme={theme}
                />
              ))}
          </div>
        </section>
      </div>
      <FilterDropdownFooter
        selectedCount={selectedCount}
        clearFilters={picker.clearFilters}
        theme={theme}
      />
    </div>
  );
}

function FilterDropdownFooter({
  selectedCount,
  clearFilters,
  theme,
}: {
  selectedCount: number;
  clearFilters: () => void;
  theme: ConversationLogTheme;
}) {
  return (
    <div className={theme.filterFooterBar}>
      <span className={
        "text-[13px] " + theme.filterFooterText
      }>
        {selectedCount === 0
          ? "No filters selected"
          : `${selectedCount} active filter`
            + `${selectedCount === 1
              ? ""
              : "s"}`}
      </span>
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className={
            "text-[13px] "
            + theme.filterClearButton
          }
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
  theme,
}: {
  selected: boolean;
  label: string;
  description?: string;
  onToggle: () => void;
  theme: ConversationLogTheme;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={
        "flex w-full items-start gap-2"
        + " rounded px-1.5 py-1.5 text-left "
        + theme.filterOptionHover
      }
    >
      <span
        className={
          "mt-[1px] inline-flex size-4"
          + " shrink-0 items-center"
          + " justify-center rounded border "
          + (selected
            ? theme.filterCheckboxSelected
            : theme.filterCheckboxDefault)
        }
      >
        <Check className="size-2.5" />
      </span>
      <span className="min-w-0">
        <span className={
          "block truncate text-[15px]"
          + " leading-6 "
          + theme.filterOptionText
        }>
          {label}
        </span>
        {description ? (
          <span className={
            "block truncate text-[13px] "
            + theme.filterOptionDescription
          }>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
