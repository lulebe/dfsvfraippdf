import { describe, expect, it } from "vitest";
import { filterAirports, formatDate, hasKnownChartDates, latestChartDate, parseAipDate, parseAirportSearchConfig, type ChartDocument } from "./domain";

describe("DFS source parsing", () => {
  it("reads airport labels, stable DFS identifiers, and ICAO codes from the search config", () => {
    const source = String.raw`const permalinks=[{label:"Aachen Universitaetsklinikum",value:"C01B07"},{label:"Aachen-Merzbrueck EDKA",value:"C0194C"},{label:"Berlin \"BER\" EDDB",value:"C01A00"}];`;
    expect(parseAirportSearchConfig(source)).toEqual([
      { label: "Aachen-Merzbrueck EDKA", id: "C0194C", icao: "EDKA" },
      { label: "Berlin \"BER\" EDDB", id: "C01A00", icao: "EDDB" },
    ]);
  });

  it("recognizes military ICAO codes", () => {
    expect(parseAirportSearchConfig('const permalinks=[{label:"ETNG Geilenkirchen",value:"C01234"}];')[0].icao).toBe("ETNG");
  });

  it("excludes entries without a German ICAO airport code", () => {
    expect(parseAirportSearchConfig('const permalinks=[{label:"Aachen Universitaetsklinikum",value:"C01B07"}];')).toEqual([]);
  });

  it("searches ICAO codes and airport names without diacritic sensitivity", () => {
    const airports = [
      { id: "1", label: "Muenchen EDDA", icao: "EDDA" },
      { id: "2", label: "Wuerzburg-Schenkenturm EDFW", icao: "EDFW" },
    ];
    expect(filterAirports(airports, "edfw").map((airport) => airport.id)).toEqual(["2"]);
    expect(filterAirports(airports, "wuerzburg").map((airport) => airport.id)).toEqual(["2"]);
    expect(filterAirports(airports, "würzburg").map((airport) => airport.id)).toEqual(["2"]);
  });

  it("extracts the last chart-specific AIP date instead of the publication date", () => {
    expect(parseAipDate("Effective: 15 OCT 2026\nEDKA Aachen-Merzbrueck 1\n30 APR 2026")).toBe("2026-04-30");
    expect(parseAipDate("No date here")).toBe("");
    expect(formatDate("2026-04-30")).toBe("30 Apr 2026");
  });

  it("reports the newest source chart revision for an airport", () => {
    const charts = [
      { name: "EDKA 1", href: "", revisionDate: "2026-04-30", imageDataUrl: "" },
      { name: "EDKA 2", href: "", revisionDate: "2026-06-15", imageDataUrl: "" },
    ] satisfies ChartDocument[];
    expect(latestChartDate(charts)).toBe("2026-06-15");
    expect(hasKnownChartDates(charts)).toBe(true);
    expect(hasKnownChartDates([{ ...charts[0], revisionDate: "" }])).toBe(false);
  });
});