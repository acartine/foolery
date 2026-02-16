import { NextRequest, NextResponse } from "next/server";
import {
  getRegisteredAgents,
  addRegisteredAgent,
  removeRegisteredAgent,
} from "@/lib/settings";
import { registeredAgentSchema } from "@/lib/schemas";
import { z } from "zod/v4";

export async function GET() {
  const agents = await getRegisteredAgents();
  return NextResponse.json({ ok: true, data: agents });
}

const RESERVED_IDS = new Set(["default"]);

const addAgentBody = z.object({
  id: z.string().min(1).refine((v) => !RESERVED_IDS.has(v), {
    message: '"default" is a reserved agent id',
  }),
  command: z.string().min(1),
  model: z.string().optional(),
  label: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = addAgentBody.parse(await request.json());
    const agent = registeredAgentSchema.parse({
      command: body.command,
      model: body.model,
      label: body.label,
    });
    const updated = await addRegisteredAgent(body.id, agent);
    return NextResponse.json({ ok: true, data: updated.agents });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}

const removeAgentBody = z.object({ id: z.string().min(1) });

export async function DELETE(request: NextRequest) {
  try {
    const body = removeAgentBody.parse(await request.json());
    const updated = await removeRegisteredAgent(body.id);
    return NextResponse.json({ ok: true, data: updated.agents });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
