import { describe, expect, it } from "vitest";
import { directoryBrowserLayoutClasses } from "../directory-browser";

describe("DirectoryBrowser layout", () => {
  it("keeps the breadcrumb visible while the directory list scrolls", () => {
    expect(directoryBrowserLayoutClasses.dialog).toContain(
      "max-h-[calc(100vh-4rem)]",
    );
    expect(directoryBrowserLayoutClasses.dialog).toContain("overflow-y-auto");

    expect(directoryBrowserLayoutClasses.breadcrumb).toContain("min-h-5");
    expect(directoryBrowserLayoutClasses.breadcrumb).toContain("shrink-0");
    expect(directoryBrowserLayoutClasses.breadcrumb).toContain(
      "overflow-y-hidden",
    );

    expect(directoryBrowserLayoutClasses.upRow).toContain("shrink-0");
    expect(directoryBrowserLayoutClasses.list).toContain("min-h-[300px]");
    expect(directoryBrowserLayoutClasses.list).toContain("flex-1");
    expect(directoryBrowserLayoutClasses.list).toContain("overflow-y-auto");
  });
});
