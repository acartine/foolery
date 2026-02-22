import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { z } from "zod/v4";

const mergeBeadsSchema = z.object({
  survivorId: z.string().min(1),
  consumedId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = mergeBeadsSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { survivorId, consumedId } = parsed.data;

  // Fetch both beads in parallel
  const [survivorResult, consumedResult] = await Promise.all([
    getBackend().get(survivorId, repoPath),
    getBackend().get(consumedId, repoPath),
  ]);

  if (!survivorResult.ok || !survivorResult.data) {
    return NextResponse.json(
      { error: survivorResult.error?.message ?? `Survivor bead ${survivorId} not found` },
      { status: 404 }
    );
  }
  if (!consumedResult.ok || !consumedResult.data) {
    return NextResponse.json(
      { error: consumedResult.error?.message ?? `Consumed bead ${consumedId} not found` },
      { status: 404 }
    );
  }

  const survivor = survivorResult.data;
  const consumed = consumedResult.data;

  // Build merged fields: append consumed's description, notes, and labels to survivor
  const fields: Record<string, string | string[] | undefined> = {};

  // Append description
  const consumedDesc = consumed.description?.trim();
  if (consumedDesc) {
    const survivorDesc = survivor.description?.trim() ?? "";
    fields.description = survivorDesc
      ? `${survivorDesc}\n\n--- merged from ${consumedId} ---\n${consumedDesc}`
      : consumedDesc;
  }

  // Append notes
  const consumedNotes = consumed.notes?.trim();
  if (consumedNotes) {
    const survivorNotes = survivor.notes?.trim() ?? "";
    fields.notes = survivorNotes
      ? `${survivorNotes}\n\n--- merged from ${consumedId} ---\n${consumedNotes}`
      : consumedNotes;
  }

  // Append labels (deduplicated — only add labels the survivor doesn't already have)
  const survivorLabels = new Set(survivor.labels ?? []);
  const newLabels = (consumed.labels ?? []).filter(
    (label) => label.trim() && !survivorLabels.has(label)
  );
  if (newLabels.length > 0) {
    fields.labels = newLabels;
  }

  // Update survivor with merged content (if there's anything to merge)
  if (Object.keys(fields).length > 0) {
    const updateResult = await getBackend().update(
      survivorId,
      fields as import("@/lib/backend-port").UpdateBeadInput,
      repoPath,
    );
    if (!updateResult.ok) {
      return NextResponse.json(
        { error: updateResult.error?.message ?? "Failed to update survivor bead" },
        { status: 500 }
      );
    }
  }

  // Close the consumed bead
  const closeResult = await getBackend().close(
    consumedId,
    `Merged into ${survivorId}`,
    repoPath,
  );
  if (!closeResult.ok) {
    return NextResponse.json(
      { error: closeResult.error?.message ?? "Failed to close consumed bead" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, data: { survivorId, consumedId } });
}
