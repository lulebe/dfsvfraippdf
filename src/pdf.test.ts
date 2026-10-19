import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createAirportPdf, getA4ImagePlacement } from "./pdf";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("A4 airport PDF", () => {
  it("rotates landscape charts counterclockwise and keeps the visible bounds on A4", () => {
    const placement = getA4ImagePlacement(1498, 1170);
    const visibleLeft = placement.x - placement.height;
    const visibleRight = placement.x;
    const visibleBottom = placement.y;
    const visibleTop = placement.y + placement.width;

    expect(placement.rotation).toBe(90);
    expect(visibleLeft).toBeGreaterThanOrEqual(0);
    expect(visibleRight).toBeLessThanOrEqual(595.28);
    expect(visibleBottom).toBeGreaterThanOrEqual(0);
    expect(visibleTop).toBeLessThanOrEqual(841.89);
    expect((visibleLeft + visibleRight) / 2).toBeCloseTo(595.28 / 2, 5);
    expect((visibleBottom + visibleTop) / 2).toBeCloseTo(841.89 / 2, 5);
  });

  it("leaves portrait chart images upright", () => {
    const placement = getA4ImagePlacement(875, 1241);
    expect(placement.rotation).toBe(0);
    expect(placement.x).toBeGreaterThanOrEqual(0);
    expect(placement.y).toBeGreaterThanOrEqual(0);
    expect(placement.x + placement.width).toBeLessThanOrEqual(595.28);
    expect(placement.y + placement.height).toBeLessThanOrEqual(841.89);
  });

  it("creates an A4 cover and a separate A4 page for each official chart image", async () => {
    const progress: Array<[number, number]> = [];
    const bytes = await createAirportPdf("Aachen-Merzbrueck", "EDKA", "2026-10-15", [
      { name: "EDKA 1", href: "", revisionDate: "2026-04-30", imageDataUrl: onePixelPng },
      { name: "EDKA 2", href: "", revisionDate: "2026-06-15", imageDataUrl: onePixelPng },
    ], new Date("2026-10-19T10:00:00Z"), (completed, total) => progress.push([completed, total]));
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(3);
    expect(document.getTitle()).toContain("EDKA Aachen-Merzbrueck");
    expect(progress).toEqual([[1, 2], [2, 2]]);
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    }
  });

  it("includes every source page from the DFS airport list", async () => {
    const sourcePages = ["1", "2", "2A", "2B", "3", "4", "AD 2-67"].map((name) => ({
      name: `EDFM Mannheim City ${name}`,
      href: name,
      revisionDate: "2026-03-19",
      imageDataUrl: onePixelPng,
    }));
    const bytes = await createAirportPdf("Mannheim City", "EDFM", "2026-10-15", sourcePages);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(sourcePages.length + 1);
  });
});