import { describe, expect, it } from "vitest";
import {
  buildVersionBannerData,
} from "@/components/app-header-hooks";

describe("buildVersionBannerData", () => {
  it("derives banner versions from the shared version status", () => {
    expect(buildVersionBannerData({
      installedVersion: "0.13.3",
      latestVersion: "0.13.4",
      updateAvailable: true,
    })).toEqual({
      installedVersion: "0.13.3",
      latestVersion: "0.13.4",
    });
  });

  it("does not render update copy when required versions are missing", () => {
    expect(buildVersionBannerData({
      installedVersion: "0.13.3",
      latestVersion: null,
      updateAvailable: true,
    })).toBeNull();
  });
});
