import { beforeEach, describe, expect, it, vi } from "vitest";

const localStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => localStore.get(key) ?? null,
  setItem: (key: string, value: string) =>
    localStore.set(key, value),
  removeItem: (key: string) => localStore.delete(key),
  clear: () => localStore.clear(),
};

vi.stubGlobal("localStorage", mockLocalStorage);

import {
  saveDraft,
  loadDraft,
  clearDraft,
  hasDraft,
  mergeDraftDefaults,
} from "@/lib/create-draft-persistence";
import type { CreateDraftData } from "@/lib/create-draft-persistence";

describe("draft storage operations", () => {
  beforeEach(() => {
    localStore.clear();
  });

  describe("saveDraft / loadDraft", () => {
    it("round-trips draft data", () => {
      const draft: CreateDraftData = {
        title: "Fix login bug",
        description: "Users cannot log in",
        type: "bug",
        priority: 1,
        labels: ["urgent", "frontend"],
        acceptance: "Login works",
        blocks: ["beat-1"],
        blockedBy: ["beat-2"],
      };
      saveDraft(draft);
      expect(loadDraft()).toEqual(draft);
    });

    it("returns null when nothing stored", () => {
      expect(loadDraft()).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      localStore.set(
        "foolery:create-beat-draft",
        "not-json{",
      );
      expect(loadDraft()).toBeNull();
    });

    it("returns null for non-object JSON", () => {
      localStore.set(
        "foolery:create-beat-draft",
        '"just a string"',
      );
      expect(loadDraft()).toBeNull();
    });

    it("overwrites previous draft", () => {
      saveDraft({ title: "First" });
      saveDraft({ title: "Second" });
      expect(loadDraft()?.title).toBe("Second");
    });
  });

  describe("clearDraft", () => {
    it("removes draft from storage", () => {
      saveDraft({ title: "temp" });
      clearDraft();
      expect(loadDraft()).toBeNull();
    });

    it("does not throw when empty", () => {
      expect(() => clearDraft()).not.toThrow();
    });
  });

  describe("hasDraft", () => {
    it("returns false when empty", () => {
      expect(hasDraft()).toBe(false);
    });

    it("returns true when draft exists", () => {
      saveDraft({ title: "exists" });
      expect(hasDraft()).toBe(true);
    });

    it("returns false after clearing", () => {
      saveDraft({ title: "exists" });
      clearDraft();
      expect(hasDraft()).toBe(false);
    });
  });
});

describe("mergeDraftDefaults", () => {
  const defaults = {
    title: "",
    description: "",
    type: "work",
    priority: 2,
    labels: [] as string[],
    acceptance: "",
  };

  it("returns defaults when no draft", () => {
    expect(mergeDraftDefaults(defaults, null)).toEqual(
      defaults,
    );
  });

  it("merges draft fields over defaults", () => {
    const draft: CreateDraftData = {
      title: "My title",
      priority: 0,
      labels: ["bug"],
    };
    const result = mergeDraftDefaults(defaults, draft);
    expect(result.title).toBe("My title");
    expect(result.priority).toBe(0);
    expect(result.labels).toEqual(["bug"]);
    expect(result.description).toBe("");
    expect(result.type).toBe("work");
  });

  it("does not override with empty draft fields", () => {
    const draft: CreateDraftData = {
      title: "",
      labels: [],
    };
    const result = mergeDraftDefaults(defaults, draft);
    expect(result.title).toBe("");
    expect(result.labels).toEqual([]);
  });
});
