import { redirect } from "next/navigation";
import { listRepos } from "@/lib/registry";

export default async function Home() {
  const repos = await listRepos();
  if (repos.length > 0) {
    redirect("/beads");
  }
  redirect("/registry");
}
