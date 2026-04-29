import { NextRequest, NextResponse } from "next/server";
import {
  getRegisteredAgents,
  addRegisteredAgent,
  removeRegisteredAgent,
} from "@/lib/settings";
import { registeredAgentSchema } from "@/lib/schemas";
import { logApiError } from "@/lib/server-logger";
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
  agent_type: z.string().optional(),
  vendor: z.string().optional(),
  provider: z.string().optional(),
  agent_name: z.string().optional(),
  lease_model: z.string().optional(),
  model: z.string().optional(),
  flavor: z.string().optional(),
  version: z.string().optional(),
  approvalMode: z.enum(["bypass", "prompt"]).optional(),
  label: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = addAgentBody.parse(await request.json());
    const agent = registeredAgentSchema.parse({
      command: body.command,
      agent_type: body.agent_type,
      vendor: body.vendor,
      provider: body.provider,
      agent_name: body.agent_name,
      lease_model: body.lease_model,
      model: body.model,
      flavor: body.flavor,
      version: body.version,
      approvalMode: body.approvalMode,
      label: body.label,
    });
    const updated = await addRegisteredAgent(body.id, agent);
    return NextResponse.json({ ok: true, data: updated.agents });
  } catch (err) {
    logApiError({
      method: "POST",
      path: "/api/settings/agents",
      status: 400,
      error: (err as Error).message,
    });
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}

const removeAgentBody = z.object({ id: z.string().min(1) });
const removeAgentDecisionSchema = z.object({
  mode: z.enum(["remove", "replace"]),
  replacementAgentId: z.string().optional(),
});
const removeAgentPlanBody = removeAgentBody.extend({
  actionReplacements: z.record(z.string(), z.string()).optional(),
  poolDecisions: z
    .record(z.string(), removeAgentDecisionSchema)
    .optional(),
});

export async function DELETE(request: NextRequest) {
  try {
    const body = removeAgentPlanBody.parse(
      await request.json(),
    );
    const updated = await removeRegisteredAgent(body);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    logApiError({
      method: "DELETE",
      path: "/api/settings/agents",
      status: 400,
      error: (err as Error).message,
    });
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
