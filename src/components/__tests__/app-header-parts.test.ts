import {
  Children, isValidElement, type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import {
  VersionBannerBar,
} from "@/components/app-header-parts";
import { Button } from "@/components/ui/button";

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
  it("renders a visible update action in the banner", () => {
    const tree = VersionBannerBar({
      banner: {
        installedVersion: "0.5.1",
        latestVersion: "0.6.0",
      },
      copied: false,
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
      copied: false,
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
      copied: false,
      onUpdateNow: vi.fn(),
      onDismiss: vi.fn(),
    });

    const text = flattenText(tree);
    expect(text).toContain("v0.6.0");
    expect(text).toContain("v0.5.1");
    expect(text).not.toContain("vv0.6.0");
  });
});
