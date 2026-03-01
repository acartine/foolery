"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createBeatSchema, updateBeatSchema } from "@/lib/schemas";
import type { CreateBeatInput, UpdateBeatInput } from "@/lib/schemas";
import type { MemoryWorkflowDescriptor } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Zap } from "lucide-react";
import { RelationshipPicker } from "@/components/relationship-picker";

const PRIORITIES = [0, 1, 2, 3, 4] as const;

export interface RelationshipDeps {
  blocks: string[];
  blockedBy: string[];
}

type BeatFormProps =
  | {
      mode: "create";
      defaultValues?: Partial<CreateBeatInput>;
      workflows?: MemoryWorkflowDescriptor[];
      hideTypeSelector?: boolean;
      onSubmit: (data: CreateBeatInput, deps?: RelationshipDeps) => void;
      onCreateMore?: (data: CreateBeatInput, deps?: RelationshipDeps) => void;
      onBreakdown?: (data: CreateBeatInput) => void;
      isSubmitting?: boolean;
    }
  | {
      mode: "edit";
      defaultValues?: Partial<UpdateBeatInput>;
      onSubmit: (data: UpdateBeatInput) => void;
    };

export function BeatForm(props: BeatFormProps) {
  const { mode, defaultValues, onSubmit } = props;
  const onCreateMore = props.mode === "create" ? props.onCreateMore : undefined;
  const onBreakdown = props.mode === "create" ? props.onBreakdown : undefined;
  const isSubmitting = props.mode === "create" ? props.isSubmitting : false;
  const workflows = props.mode === "create" ? (props.workflows ?? []) : [];
  const hideTypeSelector = props.mode === "create" ? (props.hideTypeSelector ?? false) : false;
  const schema = mode === "create" ? createBeatSchema : updateBeatSchema;
  const [blocks, setBlocks] = useState<string[]>([]);
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      type: "work" as const,
      priority: 2 as const,
      labels: [] as string[],
      acceptance: "",
      ...defaultValues,
    },
  });
  const workflowError =
    mode === "create"
      ? (
          formErrorMap(form.formState.errors) as Partial<
            Record<keyof CreateBeatInput, { message?: string }>
          >
        ).profileId?.message ??
        (
          formErrorMap(form.formState.errors) as Partial<
            Record<keyof CreateBeatInput, { message?: string }>
          >
        ).workflowId?.message
      : undefined;

  const handleFormSubmit = form.handleSubmit((data) => {
    if (mode === "create") {
      (onSubmit as (d: CreateBeatInput, deps?: RelationshipDeps) => void)(
        data as CreateBeatInput,
        { blocks, blockedBy },
      );
    } else {
      (onSubmit as (d: UpdateBeatInput) => void)(data as UpdateBeatInput);
    }
  });

  const handleCreateMoreClick = form.handleSubmit((data) => {
    if (onCreateMore) {
      onCreateMore(data as CreateBeatInput, { blocks, blockedBy });
      setBlocks([]);
      setBlockedBy([]);
    }
  });

  const handleBreakdownClick = form.handleSubmit((data) => {
    if (onBreakdown) {
      onBreakdown(data as CreateBeatInput);
    }
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-2">
      <FormField label="Title" error={form.formState.errors.title?.message}>
        <Input placeholder="Beat title" autoFocus {...form.register("title")} />
      </FormField>

      <FormField label="Description">
        <Textarea
          placeholder="Description"
          {...form.register("description")}
        />
      </FormField>

      {mode === "create" && workflows.length > 0 && (
        <FormField
          label="Profile"
          error={workflowError}
        >
          <Select
            value={form.watch("profileId") ?? form.watch("workflowId")}
            onValueChange={(v) => {
              form.setValue("profileId", v as never);
              form.setValue("workflowId", undefined as never);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  {workflow.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}

      <div className={hideTypeSelector ? "" : "grid grid-cols-2 gap-2"}>
        {!hideTypeSelector && (
          <FormField label="Type">
            <Input
              placeholder="e.g. task, bug, feature"
              {...form.register("type")}
            />
          </FormField>
        )}

        <FormField label="Priority">
          <Select
            value={String(form.watch("priority"))}
            onValueChange={(v) => form.setValue("priority", Number(v) as never)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={String(p)}>
                  P{p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <FormField label="Labels (comma-separated)">
        <Input
          placeholder="bug, frontend, urgent"
          {...form.register("labels", {
            setValueAs: (v: string | string[]) =>
              typeof v === "string"
                ? v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : v,
          })}
        />
      </FormField>

      <FormField label="Acceptance criteria">
        <Textarea
          placeholder="Acceptance criteria"
          {...form.register("acceptance")}
        />
      </FormField>

      {mode === "create" && (
        <>
          <RelationshipPicker
            label="Blocks"
            selectedIds={blocks}
            onAdd={(id) => setBlocks((prev) => [...prev, id])}
            onRemove={(id) =>
              setBlocks((prev) => prev.filter((x) => x !== id))
            }
          />
          <RelationshipPicker
            label="Blocked By"
            selectedIds={blockedBy}
            onAdd={(id) => setBlockedBy((prev) => [...prev, id])}
            onRemove={(id) =>
              setBlockedBy((prev) => prev.filter((x) => x !== id))
            }
          />
        </>
      )}

      <div className="flex gap-2">
        <Button type="submit" title="Submit" variant="success" className="flex-1" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : mode === "create" ? "Done" : "Update"}
        </Button>
        {onCreateMore && (
          <Button title="Create this beat and start another"
            type="button"
            variant="success-light"
            className="flex-1"
            onClick={handleCreateMoreClick}
            disabled={isSubmitting}
          >
            Create More
          </Button>
        )}
        {onBreakdown && (
          <Button
            title="Create and decompose into sub-tasks with AI"
            type="button"
            variant="outline"
            className="gap-1"
            onClick={handleBreakdownClick}
            disabled={isSubmitting}
          >
            <Zap className="size-3.5" />
            Breakdown
          </Button>
        )}
      </div>
    </form>
  );
}

function formErrorMap(
  errors: unknown,
): Record<string, { message?: string } | undefined> {
  if (!errors || typeof errors !== "object") return {};
  return errors as Record<string, { message?: string } | undefined>;
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
