"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  capsuleMeta,
  renderedHandoffCapsules,
  type RenderedCapsule,
} from "@/components/beat-table-metadata";
import type { Beat } from "@/lib/types";

interface HandoffCapsulesPanelProps {
  beat: Beat;
}

export function HandoffCapsulesPanel({
  beat,
}: HandoffCapsulesPanelProps) {
  const capsules = renderedHandoffCapsules(beat);
  const [sectionOpen, setSectionOpen] = useState(true);

  if (capsules.length === 0) return null;

  const panelId = `handoff-capsules-${beat.id}`;

  return (
    <section className="space-y-1.5" aria-label="Handoff Capsules">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        aria-expanded={sectionOpen}
        aria-controls={panelId}
        onClick={() => setSectionOpen((value) => !value)}
      >
        {sectionOpen ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <span>Handoff Capsules</span>
        <span className="ml-auto font-mono text-[10px]">
          {capsules.length}
        </span>
      </button>

      {sectionOpen && (
        <div
          id={panelId}
          className="max-h-[50vh] space-y-1 overflow-y-auto pr-0.5"
        >
          {capsules.map((capsule) => (
            <HandoffCapsuleCard
              key={capsule.key}
              capsule={capsule}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HandoffCapsuleCard({
  capsule,
}: {
  capsule: RenderedCapsule;
}) {
  const meta = capsuleMeta(capsule.entry);

  return (
    <article className="rounded-md border border-border/70 bg-background/50 px-2 py-1.5 text-xs">
      {meta && (
        <p className="mb-1 break-words text-[10px] leading-snug text-muted-foreground">
          {meta}
        </p>
      )}
      <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-foreground">
        {capsule.content}
      </p>
    </article>
  );
}
