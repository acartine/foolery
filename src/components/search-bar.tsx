"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarInnerProps {
  className?: string;
  inputClassName?: string;
  placeholder?: string;
}

function SearchBarInner({
  className,
  inputClassName,
  placeholder = "Search beats...",
}: SearchBarInnerProps) {
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
    <form
      onSubmit={handleSubmit}
      className={cn("relative mx-2 flex-1 max-w-md", className)}
    >
      <Input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className={cn("h-7 pr-7", inputClassName)}
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

interface SearchBarProps {
  className?: string;
  inputClassName?: string;
  placeholder?: string;
}

export function SearchBar({
  className,
  inputClassName,
  placeholder,
}: SearchBarProps = {}) {
  return (
    <Suspense fallback={<div className={cn("mx-2 flex-1 max-w-md", className)} />}>
      <SearchBarInner
        className={className}
        inputClassName={inputClassName}
        placeholder={placeholder}
      />
    </Suspense>
  );
}
