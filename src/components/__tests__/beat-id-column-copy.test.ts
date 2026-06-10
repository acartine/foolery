import type { CellContext } from "@tanstack/react-table";
import {
  isValidElement,
  type ReactElement,
} from "react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { idColumn } from "@/components/beat-column-defs";
import type { Beat } from "@/lib/types";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

function makeBeat(
  overrides: Partial<Beat> = {},
): Beat {
  return {
    id: "foolery-5ef0",
    title: "Copy queue beat id",
    type: "work",
    state: "ready_for_implementation",
    priority: 2,
    labels: [],
    aliases: ["5ef0"],
    created: "2026-06-10T09:00:00.000Z",
    updated: "2026-06-10T09:15:00.000Z",
    ...overrides,
  };
}

function renderIdButton(
  beat: Beat,
  copyFullIdOnIdClick: boolean,
) {
  const cell = idColumn(copyFullIdOnIdClick).cell;
  if (typeof cell !== "function") {
    throw new Error("expected id column cell renderer");
  }
  const rendered = cell({
    row: { original: beat },
  } as CellContext<Beat, unknown>);
  if (!isValidElement(rendered)) {
    throw new Error("expected id column to render an element");
  }
  return rendered as ReactElement<{
    onClick: (event: { stopPropagation: () => void }) => void;
  }>;
}

describe("idColumn copy behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("copies the fully qualified beat id when queue copy mode is enabled", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const stopPropagation = vi.fn();
    const button = renderIdButton(makeBeat(), true);

    button.props.onClick({ stopPropagation });
    await Promise.resolve();

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("foolery-5ef0");
    expect(toastSuccess).toHaveBeenCalledWith("Copied: foolery-5ef0");
  });

  it("keeps the display-label copy target outside queue copy mode", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const button = renderIdButton(
      makeBeat({ aliases: ["friendly-5ef0"] }),
      false,
    );

    button.props.onClick({ stopPropagation: vi.fn() });
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("friendly-5ef0");
    expect(toastSuccess).toHaveBeenCalledWith("Copied: friendly-5ef0");
  });
});
