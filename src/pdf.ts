import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatDate, latestChartDate, type ChartDocument } from "./domain";

const A4_PORTRAIT = { width: 595.28, height: 841.89 };

export function getA4ImagePlacement(imageWidth: number, imageHeight: number): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90;
} {
  const rotate = imageWidth > imageHeight;
  const scale = rotate
    ? Math.min(A4_PORTRAIT.width / imageHeight, A4_PORTRAIT.height / imageWidth)
    : Math.min(A4_PORTRAIT.width / imageWidth, A4_PORTRAIT.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: rotate ? (A4_PORTRAIT.width - height) / 2 + height : (A4_PORTRAIT.width - width) / 2,
    y: rotate ? (A4_PORTRAIT.height - width) / 2 : (A4_PORTRAIT.height - height) / 2,
    width,
    height,
    rotation: rotate ? 90 : 0,
  };
}

export async function createAirportPdf(
  airportName: string,
  icao: string,
  publicationDate: string,
  charts: ChartDocument[],
  generatedAt = new Date(),
): Promise<Uint8Array> {
  if (charts.length === 0) throw new Error("No chart pages are available for this airport.");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.19, 0.16);
  const muted = rgb(0.36, 0.43, 0.39);
  const accent = rgb(0.83, 0.29, 0.20);

  const cover = document.addPage([A4_PORTRAIT.width, A4_PORTRAIT.height]);
  cover.drawRectangle({ x: 0, y: 0, width: 8, height: A4_PORTRAIT.height, color: accent });
  cover.drawText("DFS AIP VFR  /  AIRPORT CHART SET", { x: 48, y: 770, size: 10, font: bold, color: muted });
  cover.drawText(icao || "VFR", { x: 48, y: 690, size: 42, font: bold, color: ink });
  cover.drawText(airportName, { x: 48, y: 655, size: 18, font, color: ink, maxWidth: 490 });
  cover.drawLine({ start: { x: 48, y: 626 }, end: { x: 547, y: 626 }, thickness: 1, color: rgb(0.82, 0.86, 0.83) });
  cover.drawText("LATEST CHART PAGE REVISION", { x: 48, y: 592, size: 9, font: bold, color: muted });
  cover.drawText(formatDate(latestChartDate(charts)), { x: 48, y: 570, size: 15, font, color: ink });
  cover.drawText("AIP PUBLICATION EFFECTIVE", { x: 48, y: 526, size: 9, font: bold, color: muted });
  cover.drawText(formatDate(publicationDate), { x: 48, y: 504, size: 12, font, color: ink });
  cover.drawText("SOURCE", { x: 48, y: 456, size: 9, font: bold, color: muted });
  cover.drawText("DFS AIP VFR Germany", { x: 48, y: 434, size: 12, font, color: ink });
  cover.drawText("PAGES INCLUDED", { x: 48, y: 388, size: 9, font: bold, color: muted });
  cover.drawText(`${charts.length} official DFS AIP page${charts.length === 1 ? "" : "s"}`, { x: 48, y: 366, size: 12, font, color: ink });
  cover.drawText(`Generated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(generatedAt)}`, {
    x: 48, y: 84, size: 9, font, color: muted,
  });
  cover.drawText("Verify current chart currency and operational information with DFS before flight.", {
    x: 48, y: 62, size: 8, font: bold, color: accent, maxWidth: 495,
  });

  for (const chart of charts) {
    const encodedImage = chart.imageDataUrl.split(",", 2)[1];
    if (!encodedImage) throw new Error(`Chart image data is missing for ${chart.name}.`);
    const image = await document.embedPng(Uint8Array.from(atob(encodedImage), (character) => character.charCodeAt(0)));
    const page = document.addPage([A4_PORTRAIT.width, A4_PORTRAIT.height]);
    const placement = getA4ImagePlacement(image.width, image.height);
    page.drawImage(image, { ...placement, rotate: degrees(placement.rotation) });
  }

  document.setTitle(`VFR charts - ${icao} ${airportName}`);
  document.setSubject(`DFS AIP VFR effective ${formatDate(publicationDate)}`);
  document.setCreator("VFR Chart Desk");
  document.setProducer("VFR Chart Desk / pdf-lib");
  document.setCreationDate(generatedAt);
  return document.save();
}