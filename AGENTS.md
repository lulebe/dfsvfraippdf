# Project Guidelines

## Project
- Build a website for pilots in Germany to find DFS VFR AIP charts by airport, see when that airport's chart set was updated, and generate a PDF containing its charts.
- Prefer a browser-only implementation. Add a Node.js backend only when a verified technical requirement prevents the browser from accessing or processing the required data; document that requirement and keep the backend narrow.

## Data and Aviation Safety
- Before choosing an ingestion method, verify the official DFS source, available metadata, and browser compatibility.
- Treat DFS material as authoritative source data: preserve source attribution and relevant chart/version dates in generated PDFs, and do not imply that a chart is current unless its source date is known.
- Make the chart update date visible per airport and distinguish it from the time the app fetched or processed the chart set.
- Keep the source and its currency clear to users. This app must not present generated PDFs as a substitute for checking current official aeronautical information.

## Implementation
- Keep airport lookup, chart grouping, freshness metadata, and PDF generation aligned to the official source's identifiers and update information; do not infer dates from file timestamps when source dates are available.
- Once a stack is established, follow its existing conventions, add focused tests for airport-to-chart grouping and PDF contents, and document the actual install, test, and build commands. Do not invent commands before project tooling exists.