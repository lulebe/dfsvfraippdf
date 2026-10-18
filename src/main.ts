import { ArrowUpRight, CalendarDays, Download, FileText, MapPin, Navigation, RefreshCw, Search, TriangleAlert, createIcons } from "lucide";
import { filterAirports, formatDate, hasKnownChartDates, latestChartDate, parseAipDate, parseAirportSearchConfig, type AirportRecord, type ChartDocument, type ChartPageRecord } from "./domain";
import { createAirportPdf } from "./pdf";
import "./style.css";

const icons = { ArrowUpRight, CalendarDays, Download, FileText, MapPin, Navigation, RefreshCw, Search, TriangleAlert };
const airportList = document.querySelector<HTMLDivElement>("#airport-list")!;
const airportDetail = document.querySelector<HTMLElement>("#airport-detail")!;
const airportCount = document.querySelector<HTMLElement>("#airport-count")!;
const airportSearch = document.querySelector<HTMLInputElement>("#airport-search")!;
const publicationDateElement = document.querySelector<HTMLElement>("#publication-date")!;
const sourceStatus = document.querySelector<HTMLElement>("#source-status")!;
const toast = document.querySelector<HTMLDivElement>("#toast")!;
const revisionCheckTtlMs = 10 * 60 * 1000;

interface SourceResponse {
  text: string;
  sourceUrl: string;
}

interface AirportDetails {
  airport: AirportRecord;
  charts: ChartPageRecord[];
}

let airports: AirportRecord[] = [];
let publicationDate = "";
let selectedAirportId = "";
let loadingAirportId = "";
let loadingRevisionCheckAirportId = "";
let airportError = "";
let toastTimer = 0;
const detailsCache = new Map<string, AirportDetails>();
const chartCache = new Map<string, ChartDocument[]>();
const revisionCheckTimes = new Map<string, number>();
const revisionCheckErrors = new Map<string, string>();

function refreshIcons(): void {
  createIcons({ icons });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function notify(message: string): void {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

async function fetchSource(path: string): Promise<SourceResponse> {
  const response = await fetch(`/api/dfs?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error(`DFS request failed (${response.status}).`);
  return {
    text: await response.text(),
    sourceUrl: response.headers.get("X-Source-Url") ?? new URL(path, "https://aip.dfs.de").href,
  };
}

function currentAirportGroup(html: string, sourceUrl: string): { html: string; sourceUrl: string } {
  const document = new DOMParser().parseFromString(html, "text/html");
  const refresh = document.querySelector<HTMLMetaElement>('meta[http-equiv="refresh" i]')?.content;
  const target = refresh?.match(/url\s*=\s*['"]?([^'";]+)['"]?/i)?.[1]?.trim();
  return target ? { html: "", sourceUrl: new URL(target, sourceUrl).href } : { html, sourceUrl };
}

function pathFromUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== "https://aip.dfs.de") throw new Error("The DFS page linked to an unexpected external host.");
  return `${url.pathname}${url.search}`;
}

function sourceLinks(document: Document, sourceUrl: string): ChartPageRecord[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/pages/"], a[href*="../pages/"]'))
    .map((anchor) => ({
      name: (anchor.querySelector<HTMLElement>('.document-name[lang="en"]')?.textContent ?? anchor.innerText).trim().replace(/\s+/g, " "),
      href: new URL(anchor.getAttribute("href") ?? "", sourceUrl).href,
    }))
    .filter((entry) => entry.name && /\/pages\/[A-F0-9]{32}\.html$/i.test(new URL(entry.href).pathname));
}

function extractImageData(document: Document): string {
  const image = document.querySelector<HTMLImageElement>("img.pageImage");
  const dataUrl = image?.getAttribute("src") ?? "";
  if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("A chart page did not contain its expected DFS image.");
  return dataUrl;
}

async function loadAirportDetails(airport: AirportRecord): Promise<AirportDetails> {
  const initial = await fetchSource(`/BasicVFR/pages/${encodeURIComponent(airport.id)}.html`);
  const groupTarget = currentAirportGroup(initial.text, initial.sourceUrl);
  let groupHtml = groupTarget.html;
  let groupUrl = groupTarget.sourceUrl;
  if (!groupHtml) {
    const group = await fetchSource(pathFromUrl(groupUrl));
    groupHtml = group.text;
    groupUrl = group.sourceUrl;
  }

  const groupDocument = new DOMParser().parseFromString(groupHtml, "text/html");
  const bodyText = groupDocument.body.innerText;
  const icao = airport.icao || bodyText.match(/\b(ED[A-Z]{2})\b/)?.[1] || "";
  const chartLinks = sourceLinks(groupDocument, groupUrl);
  if (chartLinks.length === 0) throw new Error("No airport chart pages were found in the current DFS AIP section.");

  return { airport: { ...airport, icao }, charts: chartLinks };
}

function renderAirportList(): void {
  const filtered = filterAirports(airports, airportSearch.value);
  const visible = filtered.slice(0, 100);
  airportCount.textContent = String(airports.length).padStart(3, "0");
  if (visible.length === 0) {
    airportList.innerHTML = `<div class="list-empty"><i data-lucide="search"></i><span>${airports.length ? "No matching airports" : "No airports were found in this AIP edition."}</span></div>`;
    refreshIcons();
    return;
  }

  airportList.innerHTML = visible.map((airport) => {
    const cachedCharts = chartCache.get(airport.id);
    const update = cachedCharts ? formatDate(latestChartDate(cachedCharts)) : "Chart date not checked";
    return `
      <button class="airport-item ${airport.id === selectedAirportId ? "is-selected" : ""}" type="button" data-airport-id="${escapeHtml(airport.id)}">
        <span class="icao-mark">${escapeHtml(airport.icao)}</span>
        <span class="airport-item-copy"><strong>${escapeHtml(airport.label)}</strong><small>${escapeHtml(update)}</small></span>
        <i data-lucide="arrow-up-right"></i>
      </button>`;
  }).join("");
  if (filtered.length > visible.length) {
    airportList.insertAdjacentHTML("beforeend", `<p class="list-limit">Showing 100 of ${filtered.length}. Refine your search.</p>`);
  }
  refreshIcons();
}

function renderDetail(): void {
  if (!selectedAirportId) {
    airportDetail.innerHTML = `
      <div class="welcome-state">
        <div class="welcome-mark"><i data-lucide="navigation"></i></div>
        <p class="section-kicker">OFFICIAL SOURCE CONNECTED</p>
        <h2>Find an airport.<br /><em>Build its chart set.</em></h2>
        <p class="welcome-copy">Search the current DFS VFR AIP directory. Airport section pages and chart revision dates are loaded from DFS when selected.</p>
        <a class="button button-primary" href="https://aip.dfs.de/basicVFR/" target="_blank" rel="noreferrer">Open DFS AIP <i data-lucide="arrow-up-right"></i></a>
      </div>`;
    refreshIcons();
    return;
  }
  if (loadingAirportId === selectedAirportId) {
    airportDetail.innerHTML = '<div class="detail-loading"><span class="loading-mark"></span><p class="section-kicker">READING THE CURRENT DFS AIP</p><h2>Loading airport pages</h2><p>Fetching chart titles, images, and revision dates from the selected airport section.</p></div>';
    refreshIcons();
    return;
  }
  if (loadingRevisionCheckAirportId === selectedAirportId) {
    airportDetail.innerHTML = '<div class="detail-loading"><span class="loading-mark"></span><p class="section-kicker">CHECKING OFFICIAL PAGES</p><h2>Checking chart revisions</h2><p>Loading this airport’s chart pages one at a time. Dates will be shown before PDF export.</p></div>';
    refreshIcons();
    return;
  }
  if (airportError) {
    airportDetail.innerHTML = `<div class="detail-error"><i data-lucide="triangle-alert"></i><h2>Could not load this airport</h2><p>${escapeHtml(airportError)}</p><button class="button button-secondary" type="button" data-action="retry">Try again</button></div>`;
    refreshIcons();
    return;
  }

  const details = detailsCache.get(selectedAirportId);
  if (!details) return;
  const loadedCharts = chartCache.get(selectedAirportId);
  const checkedAt = revisionCheckTimes.get(selectedAirportId);
  const revisionsKnown = Boolean(loadedCharts && hasKnownChartDates(loadedCharts));
  const checkIsRecent = Boolean(checkedAt && Date.now() - checkedAt < revisionCheckTtlMs);
  const canExport = revisionsKnown && checkIsRecent;
  const updateDate = loadedCharts ? formatDate(latestChartDate(loadedCharts)) : "Not checked yet";
  const chartRows = details.charts.map((chart, index) => {
    const loadedChart = loadedCharts?.find((entry) => entry.href === chart.href);
    const chartDate = loadedChart ? formatDate(loadedChart.revisionDate) : "Not checked";
    return `
    <li class="chart-row">
      <span class="chart-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="chart-icon"><i data-lucide="file-text"></i></span>
      <span class="chart-copy"><strong>${escapeHtml(chart.name)}</strong><small>DFS chart page</small></span>
      <span class="chart-date">${escapeHtml(chartDate)}</span>
    </li>`;
  }).join("");
  const checkedAtLabel = checkedAt
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(checkedAt)
    : "Not checked";
  const revisionStatus = revisionCheckErrors.get(selectedAirportId)
    ?? (loadedCharts
      ? !revisionsKnown
        ? "A chart page has no readable revision date. PDF export is disabled until every page date is available."
        : !checkIsRecent
          ? "Revision check expired. Check the current chart pages again before export."
          : `Source pages checked ${checkedAtLabel}.`
      : "Check latest revisions to review dates before generating a PDF.");

  airportDetail.innerHTML = `
    <div class="detail-header"><div class="airport-title-block"><div class="airport-coordinate"><i data-lucide="map-pin"></i> GERMANY <span>/</span> DFS VFR AIP</div>
      <div class="airport-title-line"><h2>${escapeHtml(details.airport.label)}</h2>${details.airport.icao ? `<span class="icao-badge">${escapeHtml(details.airport.icao)}</span>` : ""}</div>
    </div></div>
    <div class="airport-metadata">
      <div class="metadata-block"><span class="metadata-label"><i data-lucide="calendar-days"></i> LATEST CHART REVISION</span><span class="metadata-value">${escapeHtml(updateDate)}</span><small class="metadata-subvalue">${escapeHtml(checkedAtLabel)}</small></div>
      <div class="metadata-separator"></div>
      <div class="metadata-block"><span class="metadata-label"><i data-lucide="calendar-days"></i> AIP EDITION EFFECTIVE</span><span class="metadata-value">${escapeHtml(formatDate(publicationDate))}</span></div>
    </div>
    <div class="chart-section-head"><div><p class="section-kicker">AIRPORT AIP PAGES</p><h3>Charts and documents <span>${String(details.charts.length).padStart(2, "0")}</span></h3></div>
      <div class="chart-actions">
        <button class="button ${loadedCharts ? "button-secondary" : "button-primary"}" type="button" data-action="check-revisions"><i data-lucide="refresh-cw"></i><span>${loadedCharts ? "Recheck revisions" : "Check latest revisions"}</span></button>
        ${loadedCharts ? `<button class="button button-primary" type="button" data-action="export-pdf" ${canExport ? "" : "disabled"}><i data-lucide="download"></i><span>Generate A4 PDF</span></button>` : ""}
      </div>
    </div>
    <ul class="chart-list">${chartRows}</ul>
    <div class="revision-status ${revisionCheckErrors.has(selectedAirportId) || (loadedCharts && !canExport) ? "is-warning" : ""}">${escapeHtml(revisionStatus)}</div>
    <div class="detail-footnote"><i data-lucide="triangle-alert"></i><span>Review each chart-page revision date before export. Always verify current operational information with DFS.</span></div>`;
  refreshIcons();
}

function render(): void {
  renderAirportList();
  renderDetail();
}

async function selectAirport(id: string): Promise<void> {
  selectedAirportId = id;
  airportError = "";
  render();
  if (detailsCache.has(id)) return;
  const airport = airports.find((entry) => entry.id === id);
  if (!airport) return;
  loadingAirportId = id;
  renderDetail();
  try {
    detailsCache.set(id, await loadAirportDetails(airport));
  } catch (error) {
    airportError = error instanceof Error ? error.message : "The DFS AIP request failed.";
  } finally {
    loadingAirportId = "";
    render();
  }
}

async function checkLatestRevisions(): Promise<void> {
  const airportId = selectedAirportId;
  const details = detailsCache.get(airportId);
  if (!details || loadingRevisionCheckAirportId) return;

  revisionCheckErrors.delete(airportId);
  revisionCheckTimes.delete(airportId);
  loadingRevisionCheckAirportId = airportId;
  renderDetail();
  try {
    const charts: ChartDocument[] = [];
    for (const chartLink of details.charts) {
      const page = await fetchSource(pathFromUrl(chartLink.href));
      const pageDocument = new DOMParser().parseFromString(page.text, "text/html");
      charts.push({ ...chartLink, revisionDate: parseAipDate(pageDocument.body.innerText), imageDataUrl: extractImageData(pageDocument) });
    }
    chartCache.set(airportId, charts);
    revisionCheckTimes.set(airportId, Date.now());
  } catch (error) {
    revisionCheckErrors.set(airportId, error instanceof Error ? error.message : "Could not read chart revisions.");
  } finally {
    if (loadingRevisionCheckAirportId === airportId) loadingRevisionCheckAirportId = "";
    render();
  }
}

async function loadIndex(): Promise<void> {
  sourceStatus.textContent = "CONNECTING TO DFS";
  airportList.innerHTML = '<div class="list-empty"><span class="loading-mark"></span><span>Loading the current DFS airport index</span></div>';
  try {
    const root = await fetchSource("/basicVFR/");
    const rootDocument = new DOMParser().parseFromString(root.text, "text/html");
    publicationDate = parseAipDate(rootDocument.body.innerText);
    publicationDateElement.textContent = publicationDate ? formatDate(publicationDate) : "Date not provided";
    const configUrl = new URL("../../js/config.js", root.sourceUrl);
    const config = await fetchSource(pathFromUrl(configUrl.href));
    airports = parseAirportSearchConfig(config.text);
    sourceStatus.textContent = "DFS AIP LIVE";
    selectedAirportId = "";
    render();
  } catch (error) {
    sourceStatus.textContent = "DFS UNAVAILABLE";
    airportList.innerHTML = `<div class="list-empty"><i data-lucide="triangle-alert"></i><span>${escapeHtml(error instanceof Error ? error.message : "Could not load the DFS airport index.")}</span></div>`;
    refreshIcons();
    airportDetail.innerHTML = '<div class="detail-error"><i data-lucide="triangle-alert"></i><h2>DFS source unavailable</h2><p>Check your connection and try reloading the page. The official source remains available directly at aip.dfs.de.</p><button class="button button-secondary" type="button" data-action="reload">Reload index</button></div>';
    refreshIcons();
  }
}

async function exportSelectedAirport(): Promise<void> {
  const details = detailsCache.get(selectedAirportId);
  if (!details) throw new Error("Airport pages are still loading.");
  const charts = chartCache.get(selectedAirportId);
  const checkedAt = revisionCheckTimes.get(selectedAirportId);
  if (!charts || !checkedAt) throw new Error("Check chart revisions before generating the PDF.");
  if (Date.now() - checkedAt >= revisionCheckTtlMs) {
    renderDetail();
    throw new Error("The revision check expired. Check the chart pages again before generating the PDF.");
  }
  if (!hasKnownChartDates(charts)) throw new Error("Every chart page needs a readable revision date before PDF export.");
  const pdf = await createAirportPdf(details.airport.label, details.airport.icao, publicationDate, charts);
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${details.airport.icao || "VFR"}-charts-A4.pdf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("A4 airport PDF generated in your browser.");
}

document.addEventListener("click", (event) => {
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-airport-id], [data-action]") : null;
  if (!element) return;
  if (element.dataset.airportId) void selectAirport(element.dataset.airportId);
  if (element.dataset.action === "retry") void selectAirport(selectedAirportId);
  if (element.dataset.action === "check-revisions") void checkLatestRevisions();
  if (element.dataset.action === "reload") void loadIndex();
  if (element.dataset.action === "export-pdf") {
    void exportSelectedAirport().catch((error: unknown) => notify(error instanceof Error ? error.message : "PDF generation failed."));
  }
});

airportSearch.addEventListener("input", renderAirportList);
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
    event.preventDefault();
    airportSearch.focus();
  }
});

void loadIndex();