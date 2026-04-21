"use client";

import { useEffect, useRef, useState } from "react";
import type { Beat } from "@/lib/types";
import {
  HANDOFF_METADATA_KEYS,
  NOTE_METADATA_KEYS,
  STEP_METADATA_KEYS,
  metadataEntryKey,
  pickObject,
  pickString,
  readMetadataEntries,
  readMetadataString,
  safeRelativeTime,
  stepSummary,
  type MetadataEntry,
} from "@/lib/beat-metadata";

function ExpandableText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div
      className={className}
      onMouseEnter={() => {
        if (overflows) setExpanded(true);
      }}
      onMouseLeave={() => setExpanded(false)}
    >
      <div
        ref={ref}
        className={`whitespace-pre-wrap break-words text-xs ${expanded ? "" : "line-clamp-6"}`}
      >
        {text}
      </div>
      {!expanded && overflows ? (
        <div className="mt-0.5 text-[10px] font-semibold text-moss-700">Hover to expand</div>
      ) : null}
    </div>
  );
}

function AgentBadge({
  entry,
  formatRelativeTime,
}: {
  entry: MetadataEntry;
  formatRelativeTime?: (value: string) => string;
}) {
  const metadata = pickObject(entry, ["metadata", "meta", "details"]);
  const agent =
    pickObject(entry, ["agent", "executor", "worker"]) ??
    (metadata ? pickObject(metadata, ["agent", "executor", "worker"]) : null);
  const user =
    pickObject(entry, ["user", "author", "created_by", "createdBy"]) ??
    (metadata ? pickObject(metadata, ["user", "author", "created_by", "createdBy"]) : null);
  const actor =
    pickObject(entry, ["actor", "updated_by", "updatedBy", "by"]) ??
    (metadata ? pickObject(metadata, ["actor", "updated_by", "updatedBy", "by"]) : null);

  const agentname =
    pickString(entry, ["agentname", "agentName", "agent_name"]) ??
    (metadata ? pickString(metadata, ["agentname", "agentName", "agent_name"]) : undefined) ??
    (agent ? pickString(agent, ["name", "agentname", "agentName", "agent_name"]) : undefined) ??
    "unknown-agent";

  const model =
    pickString(entry, ["model", "agentModel", "agent_model"]) ??
    (metadata ? pickString(metadata, ["model", "agentModel", "agent_model"]) : undefined) ??
    (agent ? pickString(agent, ["model", "agentModel", "agent_model"]) : undefined) ??
    "unknown-model";

  const username =
    pickString(entry, ["username", "user", "user_name", "actor", "actor_name"]) ??
    (metadata ? pickString(metadata, ["username", "user", "user_name", "actor", "actor_name"]) : undefined) ??
    (user ? pickString(user, ["name", "username", "login"]) : undefined) ??
    (actor ? pickString(actor, ["name", "username", "login"]) : undefined) ??
    "unknown-user";

  const version =
    pickString(entry, ["version", "agentVersion", "agent_version"]) ??
    (metadata ? pickString(metadata, ["version", "agentVersion", "agent_version"]) : undefined) ??
    (agent ? pickString(agent, ["version", "agentVersion", "agent_version"]) : undefined);

  const datetime = pickString(entry, [
    "datetime",
    "timestamp",
    "ts",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
    "time",
  ]) ??
    (metadata ? pickString(metadata, [
      "datetime",
      "timestamp",
      "ts",
      "created_at",
      "createdAt",
      "updated_at",
      "updatedAt",
      "time",
      "at",
      "occurred_at",
    ]) : undefined);

  return (
    <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium">{agentname}</span>
      <span className="text-muted-foreground/40">|</span>
      <span>{model}</span>
      {version ? (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span>{version}</span>
        </>
      ) : null}
      <span className="text-muted-foreground/40">|</span>
      <span>{username}</span>
      {datetime ? (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span>{safeRelativeTime(datetime, formatRelativeTime)}</span>
        </>
      ) : null}
    </div>
  );
}

function prepareMetadata(beat: Beat) {
  const description = beat.description
    ?? readMetadataString(beat, [
      "knotsDescription",
      "description",
      "body",
      "knotsBody",
    ]);
  const rawSteps = readMetadataEntries(
    beat, STEP_METADATA_KEYS,
  );
  const rawNotes = readMetadataEntries(
    beat, NOTE_METADATA_KEYS,
  );
  const rawCapsules = readMetadataEntries(
    beat, HANDOFF_METADATA_KEYS,
  );
  const noteEntries = rawNotes.length > 0
    ? rawNotes
    : beat.notes
      ? [{
          content: beat.notes,
          username: "legacy-notes",
          datetime: beat.updated,
        }]
      : [];

  const renderedSteps = rawSteps.flatMap(
    (step, index) => {
      const content = stepSummary(step);
      if (!content) return [];
      return [{
        entry: step,
        key: metadataEntryKey(step, index),
        content,
      }];
    },
  );

  const renderedNotes = noteEntries.flatMap(
    (note, index) => {
      const content = pickString(note, [
        "content", "note", "message",
        "summary", "description",
      ]);
      if (!content) return [];
      return [{
        entry: note,
        key: metadataEntryKey(note, index),
        content,
      }];
    },
  );

  const renderedCapsules = rawCapsules.flatMap(
    (capsule, index) => {
      const content = pickString(capsule, [
        "content", "summary", "message",
        "description", "note",
      ]);
      if (!content) return [];
      return [{
        entry: capsule,
        key: metadataEntryKey(capsule, index),
        content,
      }];
    },
  );

  return {
    description,
    renderedSteps,
    renderedNotes,
    renderedCapsules,
  };
}

export function BeatMetadataDetails({
  beat,
  showExpandedDetails,
  formatRelativeTime,
}: {
  beat: Beat;
  showExpandedDetails: boolean;
  formatRelativeTime?: (value: string) => string;
}) {
  const {
    description,
    renderedSteps,
    renderedNotes,
    renderedCapsules,
  } = prepareMetadata(beat);

  const hasNoContent = !description
    && renderedSteps.length === 0
    && renderedNotes.length === 0
    && renderedCapsules.length === 0;
  if (hasNoContent) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2">
      {description ? (
        <div className="rounded bg-moss-100 px-2 py-1.5 text-ink-800 dark:bg-moss-700/25 dark:text-paper-200">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-moss-700 dark:text-moss-100">
            Description
          </div>
          <ExpandableText text={description} />
        </div>
      ) : null}

      {showExpandedDetails && renderedSteps.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-700 dark:text-paper-300">
            Steps
          </div>
          {renderedSteps.map((step) => (
            <div key={step.key} className="rounded bg-paper-100 px-2 py-1.5 text-ink-800 dark:bg-walnut-200 dark:text-paper-200">
              <AgentBadge entry={step.entry} formatRelativeTime={formatRelativeTime} />
              <ExpandableText text={step.content} />
            </div>
          ))}
        </div>
      ) : null}

      {showExpandedDetails && renderedNotes.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ochre-700 dark:text-ochre-100">
            Notes
          </div>
          {renderedNotes.map((note) => (
            <div key={note.key} className="rounded bg-ochre-100 px-2 py-1.5 text-ink-800 dark:bg-ochre-700/25 dark:text-paper-200">
              <AgentBadge entry={note.entry} formatRelativeTime={formatRelativeTime} />
              <ExpandableText text={note.content} />
            </div>
          ))}
        </div>
      ) : null}

      {showExpandedDetails && renderedCapsules.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-lake-700 dark:text-lake-100">
            Handoff Capsules
          </div>
          {renderedCapsules.map((capsule) => (
            <div key={capsule.key} className="rounded bg-lake-100 px-2 py-1.5 text-ink-800 dark:bg-lake-700/25 dark:text-paper-200">
              <AgentBadge entry={capsule.entry} formatRelativeTime={formatRelativeTime} />
              <ExpandableText text={capsule.content} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
