export interface AirportRecord {
  id: string;
  label: string;
  icao: string;
}

export interface ChartPageRecord {
  name: string;
  href: string;
  printPagePath?: string;
}

export interface ChartDocument extends ChartPageRecord {
  revisionDate: string;
  imageDataUrl: string;
}

export function parseAirportSearchConfig(source: string): AirportRecord[] {
  const match = source.match(/\bpermalinks\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!match) throw new Error("The DFS airport index format was not recognized.");

  const records: AirportRecord[] = [];
  const entryPattern = /\{\s*label:("(?:\\.|[^"\\])*")\s*,\s*value:("(?:\\.|[^"\\])*")\s*\}/g;
  const entries = [...match[1].matchAll(entryPattern)];
  if (entries.length === 0) throw new Error("The DFS airport index was empty or changed format.");
  for (const entry of entries) {
    const label = JSON.parse(entry[1]) as string;
    const id = JSON.parse(entry[2]) as string;
    const icao = label.match(/\b(E[DT][A-Z]{2})\b/)?.[1] ?? "";
    if (icao) records.push({ id, label, icao });
  }
  return records;
}

export function filterAirports(airports: AirportRecord[], query: string): AirportRecord[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return airports;
  return airports.filter((airport) => normalizeSearchText(`${airport.icao} ${airport.label}`).includes(normalizedQuery));
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").trim();
}

export function parseAipDate(text: string): string {
  const matches = [...text.matchAll(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\b/g)];
  const latest = matches.at(-1);
  if (!latest) return "";
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(latest[2]) + 1;
  return `${latest[3]}-${String(month).padStart(2, "0")}-${latest[1].padStart(2, "0")}`;
}

export function parsePrintPagePath(source: string): string {
  const match = source.match(/\b(?:const|let|var)\s+myURL\s*=\s*("(?:\\.|[^"\\])*")\s*;/);
  if (!match) throw new Error("The DFS chart page did not provide its print-page path.");

  const pageId = JSON.parse(match[1]) as unknown;
  if (typeof pageId !== "string") throw new Error("The DFS chart print-page path was invalid.");
  const segments = pageId.split("/");
  if (segments.length < 2 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("The DFS chart print-page path was invalid.");
  }

  return `/basicVFR/print/${segments.map(encodeURIComponent).join("/")}`;
}

export function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date not provided";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Date not provided";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function latestChartDate(charts: ChartDocument[]): string {
  return charts.map((chart) => chart.revisionDate).filter(Boolean).sort().at(-1) ?? "";
}

export function hasKnownChartDates(charts: ChartDocument[]): boolean {
  return charts.length > 0 && charts.every((chart) => /^\d{4}-\d{2}-\d{2}$/.test(chart.revisionDate));
}