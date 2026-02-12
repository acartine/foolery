"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createBeadSchema, updateBeadSchema } from "@/lib/schemas";
import type { CreateBeadInput, UpdateBeadInput } from "@/lib/schemas";
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

const BEAD_TYPES = [
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "merge-request",
  "molecule",
  "gate",
] as const;

const PRIORITIES = [0, 1, 2, 3, 4] as const;

type BeadFormProps =
  | {
      mode: "create";
      defaultValues?: Partial<CreateBeadInput>;
      onSubmit: (data: CreateBeadInput) => void;
      onCreateMore?: (data: CreateBeadInput) => void;
    }
  | {
      mode: "edit";
      defaultValues?: Partial<UpdateBeadInput>;
      onSubmit: (data: UpdateBeadInput) => void;
    };

export function BeadForm(props: BeadFormProps) {
  const { mode, defaultValues, onSubmit } = props;
  const onCreateMore = props.mode === "create" ? props.onCreateMore : undefined;
  const schema = mode === "create" ? createBeadSchema : updateBeadSchema;
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      type: "task" as const,
      priority: 2 as const,
      labels: [] as string[],
      acceptance: "",
      ...defaultValues,
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((data) => onSubmit(data as never))}
      className="space-y-2"
    >
      <FormField label="Title" error={form.formState.errors.title?.message}>
        <Input placeholder="Bead title" autoFocus {...form.register("title")} />
      </FormField>

      <FormField label="Description">
        <Textarea
          placeholder="Description"
          {...form.register("description")}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-2">
        <FormField label="Type">
          <Select
            value={form.watch("type")}
            onValueChange={(v) => form.setValue("type", v as never)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BEAD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

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

      <div className="flex gap-2">
        <Button type="submit" variant="success" className="flex-1">
          {mode === "create" ? "Done" : "Update"}
        </Button>
        {onCreateMore && (
          <Button
            type="button"
            variant="success-light"
            className="flex-1"
            onClick={form.handleSubmit((data) => onCreateMore(data as never))}
          >
            Create More
          </Button>
        )}
      </div>
    </form>
  );
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
