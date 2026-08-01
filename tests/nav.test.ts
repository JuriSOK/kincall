import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Nav } from "@/app/ui/nav";
import { renderServerComponent } from "./support/render";

function renderNav() {
  return renderServerComponent(createElement(Nav));
}

describe("Nav (shared app header)", () => {
  it("renders the vector KinCallMark, not an <img> (the deleted JPEG)", () => {
    const html = renderNav();
    expect(html).toContain("<svg");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("kincall-logo");
  });

  it("gives the brand link a specific accessible name via aria-label, not just the visible word", () => {
    const html = renderNav();
    expect(html).toContain('aria-label="KinCall dashboard"');
  });

  it("marks the icon decorative so it is never announced a second time alongside the visible text", () => {
    const html = renderNav();
    const brandLinkMatch = html.match(/<a aria-label="KinCall dashboard"[^]*?<\/a>/);
    expect(brandLinkMatch).not.toBeNull();
    const brandLinkHtml = brandLinkMatch![0];
    expect(brandLinkHtml).toContain("<svg");
    expect(brandLinkHtml).toContain('aria-hidden="true"');
    // The svg itself must not carry its own competing accessible name here.
    const svgMatch = brandLinkHtml.match(/<svg[^>]*>/);
    expect(svgMatch![0]).not.toContain("aria-label");
    expect(svgMatch![0]).not.toContain('role="img"');
  });

  it("the brand link points at /dashboard", () => {
    const html = renderNav();
    const brandLinkMatch = html.match(/<a aria-label="KinCall dashboard"[^>]*>/);
    expect(brandLinkMatch![0]).toContain('href="/dashboard"');
  });

  it("renders the mark exactly once — no duplicate logo", () => {
    const html = renderNav();
    expect(html.match(/<svg/g)?.length).toBe(1);
  });

  it("still shows the visible 'KinCall' word next to the icon", () => {
    const html = renderNav();
    expect(html).toContain("KinCall</a>");
  });
});
