import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseQuery = vi.fn();
const mockUseQueries = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useQueries: (...args: unknown[]) => mockUseQueries(...args),
}));

import { RelationshipPicker } from "@/components/relationship-picker";

describe("RelationshipPicker aliases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: undefined });
    mockUseQueries.mockReturnValue([
      {
        data: {
          ok: true,
          data: {
            id: "foolery-df3a",
            aliases: ["ship-views"],
            title: "Views should use knot aliases",
          },
        },
      },
    ]);
  });

  it("shows aliases for selected relationship badges", () => {
    const html = renderToStaticMarkup(
      React.createElement(RelationshipPicker, {
        label: "Blocked By",
        selectedIds: ["foolery-df3a"],
        onAdd: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    expect(html).toContain("ship-views");
    expect(html).not.toContain(">df3a<");
  });

  it("loads selected beat details so aliases are available outside search results", () => {
    renderToStaticMarkup(
      React.createElement(RelationshipPicker, {
        label: "Blocks",
        selectedIds: ["foolery-df3a"],
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        repo: "/repo/demo",
      }),
    );

    expect(mockUseQueries).toHaveBeenCalledWith({
      queries: [
        expect.objectContaining({
          queryKey: ["beat", "foolery-df3a", "/repo/demo"],
          enabled: true,
        }),
      ],
    });
  });
});
