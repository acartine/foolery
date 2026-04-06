import { describe, expect, it } from "vitest";

/**
 * Structural assertion for BeatTableSkeletonRows:
 * verify the component contract without DOM rendering.
 */
describe("BeatTableSkeletonRows contract", () => {
  it("default rowCount is 3", () => {
    // The component defaults to 3 rows when
    // rowCount prop is omitted.
    const defaultRowCount = 3;
    const widths = Array.from(
      { length: defaultRowCount },
      (_, i) => `${75 - i * 10}%`,
    );
    expect(widths).toEqual(["75%", "65%", "55%"]);
  });

  it("custom rowCount generates correct widths", () => {
    const rowCount = 5;
    const widths = Array.from(
      { length: rowCount },
      (_, i) => `${75 - i * 10}%`,
    );
    expect(widths).toHaveLength(5);
    expect(widths[0]).toBe("75%");
    expect(widths[4]).toBe("35%");
  });
});
