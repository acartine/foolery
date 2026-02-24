import { NextResponse } from "next/server";
import {
  readMessageTypeIndex,
  buildMessageTypeIndex,
  writeMessageTypeIndex,
} from "@/lib/agent-message-type-index";

export async function GET() {
  try {
    let index = await readMessageTypeIndex();
    if (!index) {
      // First access — build from the two most recent log files.
      index = await buildMessageTypeIndex();
      await writeMessageTypeIndex(index);
    }
    return NextResponse.json({ data: index });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load message type index";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
