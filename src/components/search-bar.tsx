"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

function SearchBarInner() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const router = useRouter();

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  const clearSearch = () => {
    setQuery("");
    router.push("/beads");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/beads?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/beads");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      clearSearch();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex-1 max-w-md mx-2 relative">
      <Input
        type="text"
        placeholder="find your beads..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-7 pr-7"
      />
      {query && (
        <button
          type="button"
          onClick={clearSearch}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
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
