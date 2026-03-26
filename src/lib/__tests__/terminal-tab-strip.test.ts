import { describe, expect, it } from "vitest";
import {
  getTerminalTabScrollAmount,
  resolveTerminalTabDisplayLabel,
  resolveTerminalTabStripState,
  shouldUseCompactTerminalTabLabels,
} from "@/lib/terminal-tab-strip";

describe("terminal-tab-strip helpers", () => {
  describe("resolveTerminalTabStripState", () => {
    it("reports no overflow when content fits", () => {
      expect(
        resolveTerminalTabStripState({
          scrollLeft: 0,
          scrollWidth: 400,
          clientWidth: 400,
        }),
      ).toEqual({
        hasOverflow: false,
        canScrollLeft: false,
        canScrollRight: false,
      });
    });

    it("reports available direction hints while scrolling", () => {
      expect(
        resolveTerminalTabStripState({
          scrollLeft: 0,
          scrollWidth: 900,
          clientWidth: 400,
        }),
      ).toEqual({
        hasOverflow: true,
        canScrollLeft: false,
        canScrollRight: true,
      });

      expect(
        resolveTerminalTabStripState({
          scrollLeft: 250,
          scrollWidth: 900,
          clientWidth: 400,
        }),
      ).toEqual({
        hasOverflow: true,
        canScrollLeft: true,
        canScrollRight: true,
      });

      expect(
        resolveTerminalTabStripState({
          scrollLeft: 500,
          scrollWidth: 900,
          clientWidth: 400,
        }),
      ).toEqual({
        hasOverflow: true,
        canScrollLeft: true,
        canScrollRight: false,
      });
    });

    it("clamps impossible scroll positions", () => {
      expect(
        resolveTerminalTabStripState({
          scrollLeft: -10,
          scrollWidth: 900,
          clientWidth: 400,
        }).canScrollLeft,
      ).toBe(false);

      expect(
        resolveTerminalTabStripState({
          scrollLeft: 9999,
          scrollWidth: 900,
          clientWidth: 400,
        }).canScrollRight,
      ).toBe(false);
    });
  });

});

describe("terminal-tab-strip compact labels and display", () => {
  describe("compact labels and display", () => {
    it("switches to compact labels only when space is constrained", () => {
      expect(shouldUseCompactTerminalTabLabels(false, 300, 4)).toBe(false);
      expect(shouldUseCompactTerminalTabLabels(true, 1_200, 4)).toBe(false);
      expect(shouldUseCompactTerminalTabLabels(true, 520, 4)).toBe(true);
    });

    it("keeps full beat id labels in non-compact mode", () => {
      expect(
        resolveTerminalTabDisplayLabel(
          {
            prefix: "foolery",
            localId: "b83f",
          },
          false,
        ),
      ).toEqual({
        prefix: "foolery-",
        localId: "b83f",
      });
    });

    it("shortens long compact beat id labels", () => {
      expect(
        resolveTerminalTabDisplayLabel(
          {
            prefix: "extraordinaryproject",
            localId: "1234567890abcdef",
          },
          true,
        ),
      ).toEqual({
        prefix: "extraor...-",
        localId: "1234...bcdef",
      });
    });

    it("keeps short compact labels untouched", () => {
      expect(
        resolveTerminalTabDisplayLabel(
          {
            prefix: "foolery",
            localId: "b83f",
          },
          true,
        ),
      ).toEqual({
        prefix: "foolery-",
        localId: "b83f",
      });
    });
  });

  it("uses a proportional tab-scroll amount with a floor", () => {
    expect(getTerminalTabScrollAmount(0)).toBe(120);
    expect(getTerminalTabScrollAmount(100)).toBe(120);
    expect(getTerminalTabScrollAmount(500)).toBe(360);
  });
});
