import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import LandingPage from "@/app/(marketing)/page";
import { KinCallMark } from "@/frontend/components/kincall-mark";
import { collectElements, collectText } from "../support/element-tree";

describe("Landing page", () => {
  const tree = collectElements(LandingPage());

  it("renders the redrawn vector mark exactly once, not the old raster logo", () => {
    const marks = tree.filter((node) => node.type === KinCallMark);
    expect(marks).toHaveLength(1);
  });

  it("has no top-left header element", () => {
    expect(tree.some((node) => node.type === "header")).toBe(false);
  });

  it("shows exactly one standalone 'KinCall' wordmark (the hero lockup), not a second header/footer duplicate", () => {
    // The hero pairs the icon with one wordmark text node — that is the
    // logo, not a regression. What would be a regression is a *second*,
    // separate wordmark (e.g. a leftover top-left header) in addition to it.
    // Body copy sentences ("KinCall calls on a familiar schedule", …) are
    // unaffected since they are not standalone nodes equal to exactly
    // "KinCall".
    const text = collectText(LandingPage());
    const standalone = text.filter((chunk) => chunk.trim() === "KinCall");
    expect(standalone).toHaveLength(1);
  });

  it("the old raster logo asset and the hand-drawn hero-mark SVG are both gone", () => {
    expect(existsSync(new URL("../../app/ui/kincall-logo.jpeg", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../app/(marketing)/hero-mark.tsx", import.meta.url))).toBe(false);
  });

  it("preserves the floating animation on the hero lockup", () => {
    const lockup = tree.find(
      (node) => typeof node.props.className === "string" && node.props.className.includes("kc-animate-float")
    );
    expect(lockup).toBeDefined();
  });
});
