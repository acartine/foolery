"use client";

import {
  useEffect,
  useState,
} from "react";
import type { RefObject } from "react";

export function useElementWidth(
  ref: RefObject<HTMLElement | null>,
): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = () => {
      setWidth(Math.round(element.getBoundingClientRect().width));
    };
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
