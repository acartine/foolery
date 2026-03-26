"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";
import { createBeatSchema, updateBeatSchema } from "@/lib/schemas";
import type { CreateBeatInput, UpdateBeatInput } from "@/lib/schemas";
import type { MemoryWorkflowDescriptor } from "@/lib/types";
import { profileDisplayName, PROFILE_DESCRIPTIONS } from "@/lib/workflows";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { RelationshipPicker } from "@/components/relationship-picker";

const PRIORITIES = [0, 1, 2, 3, 4] as const;

export interface RelationshipDeps {
  blocks: string[];
  blockedBy: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyForm = ReturnType<typeof useForm<any>>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function ProfileSelectField({
  form,
  workflows,
  error,
  onInfoClick,
}: {
  form: AnyForm;
  workflows: MemoryWorkflowDescriptor[];
  error?: string;
  onInfoClick: () => void;
}) {
  return (
    <FormField
      label="Profile"
      error={error}
      infoAction={onInfoClick}
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
              {profileDisplayName(
                workflow.profileId ?? workflow.id,
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function TypePriorityRow({
  form,
  hideTypeSelector,
}: {
  form: AnyForm;
  hideTypeSelector: boolean;
}) {
  const cls = hideTypeSelector
    ? ""
    : "grid grid-cols-2 gap-2";
  return (
    <div className={cls}>
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
          onValueChange={(v) =>
            form.setValue("priority", Number(v) as never)
          }
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
  );
}

function RelationshipSection({
  blocks,
  blockedBy,
  setBlocks,
  setBlockedBy,
}: {
  blocks: string[];
  blockedBy: string[];
  setBlocks: React.Dispatch<React.SetStateAction<string[]>>;
  setBlockedBy: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
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
        onAdd={(id) =>
          setBlockedBy((prev) => [...prev, id])
        }
        onRemove={(id) =>
          setBlockedBy((prev) =>
            prev.filter((x) => x !== id),
          )
        }
      />
    </>
  );
}

function BeatFormActions({
  isSubmitting,
  mode,
  onCreateMore,
}: {
  isSubmitting: boolean;
  mode: "create" | "edit";
  onCreateMore?: () => void;
}) {
  const label = isSubmitting
    ? "Creating..."
    : mode === "create"
      ? "Done"
      : "Update";
  return (
    <div className="flex gap-2">
      <Button
        type="submit"
        title="Submit"
        variant="success"
        className="flex-1"
        disabled={isSubmitting}
      >
        {label}
      </Button>
      {onCreateMore && (
        <Button
          title="Create this beat and start another"
          type="button"
          variant="success-light"
          className="flex-1"
          onClick={onCreateMore}
          disabled={isSubmitting}
        >
          Create More
        </Button>
      )}
    </div>
  );
}

function LabelsField({ form }: { form: AnyForm }) {
  return (
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
  );
}

function AcceptanceField({ form }: { form: AnyForm }) {
  return (
    <FormField label="Acceptance criteria">
      <Textarea
        placeholder="Acceptance criteria"
        {...form.register("acceptance")}
      />
    </FormField>
  );
}

type BeatFormProps =
  | {
      mode: "create";
      defaultValues?: Partial<CreateBeatInput>;
      workflows?: MemoryWorkflowDescriptor[];
      hideTypeSelector?: boolean;
      onSubmit: (
        data: CreateBeatInput,
        deps?: RelationshipDeps,
      ) => void;
      onCreateMore?: (
        data: CreateBeatInput,
        deps?: RelationshipDeps,
      ) => void;
      isSubmitting?: boolean;
    }
  | {
      mode: "edit";
      defaultValues?: Partial<UpdateBeatInput>;
      onSubmit: (data: UpdateBeatInput) => void;
    };

function getWorkflowError(
  mode: string,
  errors: unknown,
): string | undefined {
  if (mode !== "create") return undefined;
  type ErrMap = Partial<
    Record<keyof CreateBeatInput, { message?: string }>
  >;
  const map = formErrorMap(errors) as ErrMap;
  return map.profileId?.message ?? map.workflowId?.message;
}

interface CreateModeProps {
  onCreateMore?: (
    data: CreateBeatInput,
    deps?: RelationshipDeps,
  ) => void;
  isSubmitting: boolean;
  workflows: MemoryWorkflowDescriptor[];
  hideTypeSelector: boolean;
}

function extractCreateProps(
  props: BeatFormProps,
): CreateModeProps {
  if (props.mode === "create") {
    return {
      onCreateMore: props.onCreateMore,
      isSubmitting: props.isSubmitting ?? false,
      workflows: props.workflows ?? [],
      hideTypeSelector: props.hideTypeSelector ?? false,
    };
  }
  return {
    isSubmitting: false,
    workflows: [],
    hideTypeSelector: false,
  };
}

function useBeatForm(props: BeatFormProps) {
  const { mode, defaultValues, onSubmit } = props;
  const create = extractCreateProps(props);
  const schema =
    mode === "create" ? createBeatSchema : updateBeatSchema;
  const [blocks, setBlocks] = useState<string[]>([]);
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [profileInfoOpen, setProfileInfoOpen] =
    useState(false);
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

  const deps = { blocks, blockedBy };
  const handleFormSubmit = form.handleSubmit((data) => {
    if (mode === "create") {
      (onSubmit as (
        d: CreateBeatInput,
        r?: RelationshipDeps,
      ) => void)(data as CreateBeatInput, deps);
    } else {
      (onSubmit as (d: UpdateBeatInput) => void)(
        data as UpdateBeatInput,
      );
    }
  });

  const handleCreateMoreClick = form.handleSubmit(
    (data) => {
      if (create.onCreateMore) {
        create.onCreateMore(
          data as CreateBeatInput, deps,
        );
        setBlocks([]);
        setBlockedBy([]);
      }
    },
  );

  return {
    mode, form, create, handleFormSubmit,
    handleCreateMoreClick, blocks, blockedBy,
    setBlocks, setBlockedBy,
    profileInfoOpen, setProfileInfoOpen,
  };
}

export function BeatForm(props: BeatFormProps) {
  const {
    mode, form, create, handleFormSubmit,
    handleCreateMoreClick, blocks, blockedBy,
    setBlocks, setBlockedBy,
    profileInfoOpen, setProfileInfoOpen,
  } = useBeatForm(props);

  const workflowError = getWorkflowError(
    mode, form.formState.errors,
  );

  return (
    <form
      onSubmit={handleFormSubmit}
      className="space-y-2"
    >
      <FormField
        label="Title"
        error={form.formState.errors.title?.message}
      >
        <Input
          placeholder="Beat title"
          autoFocus
          {...form.register("title")}
        />
      </FormField>
      <FormField label="Description">
        <Textarea
          placeholder="Description"
          {...form.register("description")}
        />
      </FormField>
      {mode === "create" &&
        create.workflows.length > 0 && (
          <ProfileSelectField
            form={form}
            workflows={create.workflows}
            error={workflowError}
            onInfoClick={() => setProfileInfoOpen(true)}
          />
        )}
      <TypePriorityRow
        form={form}
        hideTypeSelector={create.hideTypeSelector}
      />
      <LabelsField form={form} />
      <AcceptanceField form={form} />
      {mode === "create" && (
        <RelationshipSection
          blocks={blocks}
          blockedBy={blockedBy}
          setBlocks={setBlocks}
          setBlockedBy={setBlockedBy}
        />
      )}
      <BeatFormActions
        isSubmitting={create.isSubmitting}
        mode={mode}
        onCreateMore={
          create.onCreateMore
            ? handleCreateMoreClick
            : undefined
        }
      />
      <ProfileInfoDialog
        open={profileInfoOpen}
        onOpenChange={setProfileInfoOpen}
      />
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
  infoAction,
  children,
}: {
  label: string;
  error?: string;
  infoAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {infoAction && (
          <button
            type="button"
            onClick={infoAction}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Learn about ${label.toLowerCase()}`}
          >
            <Info className="size-3.5" />
          </button>
        )}
      </div>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

function ProfileInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = Object.entries(PROFILE_DESCRIPTIONS);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workflow Profiles</DialogTitle>
          <DialogDescription>
            Profiles control how work flows through planning, implementation,
            and shipment stages.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {entries.map(([id, description]) => (
            <div key={id} className="space-y-0.5">
              <p className="text-sm font-medium">{profileDisplayName(id)}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
