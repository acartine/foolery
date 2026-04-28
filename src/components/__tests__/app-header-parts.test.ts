import path from "node:path";
import { readFileSync } from "node:fs";
import {
  Children, isValidElement, type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ActionButton,
  ApprovalBannerBar,
  VersionBannerBar,
} from "@/components/app-header-parts";
import { Button } from "@/components/ui/button";
import type { AppUpdateStatus } from "@/lib/app-update-types";

type ElementWithProps = ReactElement<{
  children?: ReactNode;
  variant?: string;
  onClick?: () => void;
}>;

function findElement(
  node: ReactNode,
  predicate: (element: ElementWithProps) => boolean,
): ElementWithProps | null {
  if (!isValidElement(node)) return null;
  const element = node as ElementWithProps;

  if (predicate(element)) return element;

  for (const child of Children.toArray(
    element.props.children,
  )) {
    const match = findElement(child, predicate);
    if (match) return match;
  }

  return null;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!node || typeof node === "boolean") {
    return "";
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join("");
  }

  if (!isValidElement(node)) return "";
  const element = node as ElementWithProps;
  return flattenText(element.props.children);
}

describe("VersionBannerBar", () => {
  function makeStatus(
    phase: AppUpdateStatus["phase"],
  ): AppUpdateStatus {
    return {
      phase,
      message: null,
      error: null,
      startedAt: null,
      endedAt: null,
      workerPid: null,
      launcherPath: null,
      fallbackCommand: "foolery update && foolery restart",
    };
  }

  it("renders a visible update action in the banner", () => {
    const tree = VersionBannerBar({
      banner: {
        installedVersion: "0.5.1",
        latestVersion: "0.6.0",
      },
      updateStatus: makeStatus("idle"),
      onUpdateNow: vi.fn(),
      onDismiss: vi.fn(),
    });

    const updateButton = findElement(
      tree,
      (element) =>
        element.type === Button &&
        element.props.variant === "link",
    );

    expect(updateButton).not.toBeNull();
    expect(updateButton?.props.children).toBe(
      "Update now",
    );
  });

  it("routes the banner action through the shared update callback", () => {
    const onUpdateNow = vi.fn();
    const tree = VersionBannerBar({
      banner: {
        installedVersion: "0.5.1",
        latestVersion: "0.6.0",
      },
      updateStatus: makeStatus("idle"),
      onUpdateNow,
      onDismiss: vi.fn(),
    });

    const updateButton = findElement(
      tree,
      (element) =>
        element.type === Button &&
        element.props.onClick === onUpdateNow,
    );

    expect(updateButton).not.toBeNull();
    expect(updateButton?.props.onClick).toBe(
      onUpdateNow,
    );
    updateButton!.props.onClick!();
    expect(onUpdateNow).toHaveBeenCalledTimes(1);
  });

  it("formats installed and latest versions with a single v", () => {
    const tree = VersionBannerBar({
      banner: {
        installedVersion: "0.5.1",
        latestVersion: "v0.6.0",
      },
      updateStatus: makeStatus("idle"),
      onUpdateNow: vi.fn(),
      onDismiss: vi.fn(),
    });

    const text = flattenText(tree);
    expect(text).toContain("v0.6.0");
    expect(text).toContain("v0.5.1");
    expect(text).not.toContain("vv0.6.0");
  });

  it("surfaces automatic-update progress in the banner button", () => {
    const tree = VersionBannerBar({
      banner: {
        installedVersion: "0.5.1",
        latestVersion: "0.6.0",
      },
      updateStatus: makeStatus("restarting"),
      onUpdateNow: vi.fn(),
      onDismiss: vi.fn(),
    });

    const updateButton = findElement(
      tree,
      (element) =>
        element.type === Button &&
        element.props.variant === "link",
    );

    expect(updateButton?.props.children).toBe(
      "Restarting…",
    );
  });
});

describe("ActionButton", () => {
  it("renders no action for the finalcut view", () => {
    const tree = ActionButton({
      beatsView: "finalcut",
      shouldChooseRepo: false,
      menuOpen: false,
      setMenuOpen: vi.fn(),
      registeredRepos: [],
      openDialog: vi.fn(),
      openFlow: vi.fn(),
    });

    expect(tree).toBeNull();
  });
});

describe("ApprovalBannerBar", () => {
  it("renders pending approval count and routes to approvals", () => {
    const onOpenApprovals = vi.fn();
    const tree = ApprovalBannerBar({
      count: 2,
      onOpenApprovals,
    });

    const openButton = findElement(
      tree,
      (element) =>
        element.type === Button &&
        element.props.onClick === onOpenApprovals,
    );

    expect(flattenText(tree)).toContain("2 approvals are waiting");
    expect(openButton).not.toBeNull();
    openButton!.props.onClick!();
    expect(onOpenApprovals).toHaveBeenCalledTimes(1);
  });
});

describe("ViewSwitcher", () => {
  it("renders Setlist as the first navigation tab", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/components/app-header-parts.tsx",
      ),
      "utf8",
    );

    const setlistIdx = source.indexOf('view="setlist"');
    const queuesIdx = source.indexOf('view="queues"');
    const activeIdx = source.indexOf('view="active"');

    expect(setlistIdx).toBeGreaterThan(-1);
    expect(setlistIdx).toBeLessThan(queuesIdx);
    expect(queuesIdx).toBeLessThan(activeIdx);
  });
});
