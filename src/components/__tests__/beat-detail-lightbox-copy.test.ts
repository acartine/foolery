import { describe, expect, it, vi } from "vitest";

import {
  copyBeatIdToClipboard,
  getDisplayedBeatAliases,
  getDisplayedBeatId,
} from "../beat-detail-lightbox";

describe("beat detail ID copy", () => {
  it("uses the fully qualified loaded beat ID over the route token", () => {
    expect(
      getDisplayedBeatId("ec8e", { id: "foolery-ec8e" }),
    ).toBe("foolery-ec8e");
  });

  it("omits the beat ID itself from displayed aliases", () => {
    expect(
      getDisplayedBeatAliases({
        id: "foolery-ec8e",
        aliases: ["ec8e", "foolery-ec8e", " ec8e "],
      }),
    ).toEqual(["ec8e"]);
  });

  it("copies the beat ID and shows success feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await expect(
      copyBeatIdToClipboard("foolery-ec8e", {
        clipboard: { writeText },
        onSuccess,
        onError,
      }),
    ).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("foolery-ec8e");
    expect(onSuccess).toHaveBeenCalledWith("Copied: foolery-ec8e");
    expect(onError).not.toHaveBeenCalled();
  });

  it("shows failure feedback when the clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await expect(
      copyBeatIdToClipboard("foolery-ec8e", {
        clipboard: { writeText },
        onSuccess,
        onError,
      }),
    ).resolves.toBe(false);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Failed to copy to clipboard");
  });
});
