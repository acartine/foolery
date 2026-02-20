import { NextRequest, NextResponse } from "next/server";
import { listDeps } from "@/lib/bd";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;
  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json(
      { error: "ids parameter required" },
      { status: 400 }
    );
  }
  const ids = idsParam.split(",").filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ data: {} });
  }

  const results = await Promise.all(
    ids.map(async (id) => {
      const result = await listDeps(id, repoPath);
      return [id, result.ok ? result.data ?? [] : []] as const;
    })
  );

  return NextResponse.json({ data: Object.fromEntries(results) });
}
