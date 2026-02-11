"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export function SearchBar() {
  const [query, setQuery] = useState("");
  const router = useRouter();

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
    <form onSubmit={handleSubmit} className="flex-1 max-w-md mx-4">
      <Input
        type="text"
        placeholder="find your beads..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8"
      />
    </form>
  );
}
