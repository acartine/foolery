import { redirect } from "next/navigation";

export default async function BeadDetailRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ repo?: string | string[] }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;

  const query = new URLSearchParams({ bead: id });
  const repo = resolvedSearchParams.repo;
  const repoValue = Array.isArray(repo) ? repo[0] : repo;
  if (repoValue) query.set("detailRepo", repoValue);

  redirect(`/beads?${query.toString()}`);
}
