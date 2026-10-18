# VFR Chart Desk

A browser-first tool for searching the current DFS AIP VFR airport directory and creating an A4 PDF from the selected airport's official AIP pages. The browser parses the source pages, shows chart-page revision dates, and assembles the images into a PDF. The small Node service only proxies GET requests to DFS paths under `/basicVFR/` and `/BasicVFR/` because the DFS host does not provide browser CORS access.

DFS's AIP VFR landing page is `https://aip.dfs.de/basicVFR/`. The published airport search config provides airport labels and stable page IDs; each airport page links to its official chart pages. Select an airport, then explicitly check its latest revisions. The UI shows each page's source revision date and check time before enabling PDF generation. The check expires after ten minutes; pages with an unreadable revision date block export until successfully rechecked. Page images fetched for the check remain in browser memory and are reused for the PDF, avoiding duplicate requests. The PDF includes those pages, the AIP edition effective date, generation time, and an operational currency warning. Use the integration only within the project's obtained DFS authorization. Check the [DFS terms of use](https://ais.dfs.de/pilotservice/service/information/disclaimer/disclaimer.jsp) for the applicable scope.

Airport pages stay in the order provided by the DFS airport section. Every linked source page is included in the PDF; the app does not infer page categories or reorder pages.

The Node proxy is intentionally narrow: it accepts only GET `/api/dfs?path=...`, limits the destination to the DFS AIP origin and AIP URL paths, and returns the source body with its content type and resolved URL. It keeps the static airport-search config in memory for seven days to avoid repeatedly requesting names and identifiers. Current edition metadata and selected airport/chart pages are not cached. Airport parsing, chart-page parsing, and PDF composition run in the browser; chart pages are fetched sequentially only when revision checking is explicitly requested.

## Development and serving

- `npm install` installs dependencies.
- `npm run dev` starts Vite for development and the Node DFS proxy separately.
- `npm test` runs airport parsing, source-date, and A4 PDF tests.
- `npm run build` type-checks and creates a production build in `dist/`.
- `npm start` serves the production build and DFS proxy from the same Node server at `http://127.0.0.1:5173`. Run `npm run build` first; set `PORT` to choose another port.

The PDF has an A4 portrait cover page followed by one A4 portrait page per chart page. Source images are scaled proportionally without cropping; landscape images are rotated 90 degrees counterclockwise so the original top edge faces left, while portrait images remain upright.