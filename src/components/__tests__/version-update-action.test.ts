import {
  describe, expect, it, vi,
} from "vitest";
import {
  VERSION_UPDATE_COMMAND,
  triggerVersionUpdate,
} from "@/components/version-update-action";

describe("triggerVersionUpdate", () => {
  it("copies the update command to the clipboard", async () => {
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      triggerVersionUpdate(clipboard),
    ).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith(
      VERSION_UPDATE_COMMAND,
    );
  });

  it("returns false when clipboard writes fail", async () => {
    const clipboard = {
      writeText: vi.fn().mockRejectedValue(
        new Error("denied"),
      ),
    };

    await expect(
      triggerVersionUpdate(clipboard),
    ).resolves.toBe(false);
  });
});
