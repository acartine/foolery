"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

function SearchBarInner() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const router = useRouter();

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/beads?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/beads");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex-1 max-w-md mx-2">
      <Input
        type="text"
        placeholder="find your beads..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-7"
      />
    </form>
  );
}

export function SearchBar() {
  return (
    <Suspense fallback={<div className="flex-1 max-w-md mx-2" />}>
      <SearchBarInner />
    </Suspense>
  );
}
