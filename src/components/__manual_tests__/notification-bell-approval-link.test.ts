import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("NotificationBell approval link contract", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/notification-bell.tsx"),
    "utf8",
  );

  it("routes explicit notification hrefs before beat focus", () => {
    expect(source).toContain("notification.href");
    expect(source).toContain("router.push(notification.href)");
  });

  it("keeps beat-focus fallback for existing notifications", () => {
    expect(source).toContain("focusNotificationBeat");
    expect(source).toContain("await focusBeat(beatId, notification.repoPath)");
  });
});
