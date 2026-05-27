"use client";

import { Controller, useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-field";
import {
  VerificationStepsEditor,
} from "@/components/verification-steps-editor";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type BeatFormController = ReturnType<typeof useForm<any>>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export function LabelsField({
  form,
}: {
  form: BeatFormController;
}) {
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

export function AcceptanceField({
  form,
}: {
  form: BeatFormController;
}) {
  return (
    <FormField label="Acceptance criteria">
      <Textarea
        placeholder="Acceptance criteria"
        {...form.register("acceptance")}
      />
    </FormField>
  );
}

export function VerificationStepsField({
  form,
}: {
  form: BeatFormController;
}) {
  return (
    <FormField label="Verification steps">
      <Controller
        control={form.control}
        name="verificationSteps"
        render={({ field }) => (
          <VerificationStepsEditor
            value={
              Array.isArray(field.value)
                ? field.value
                : []
            }
            onChange={field.onChange}
          />
        )}
      />
    </FormField>
  );
}
