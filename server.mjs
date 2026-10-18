import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const upstreamOrigin = "https://aip.dfs.de";
const allowedPath = /^\/(?:basicAIP|basicVFR|BasicVFR)\//;
const airportConfigPath = /^\/basicvfr\/js\/config\.js$/i;
const airportConfigTtlMs = 7 * 24 * 60 * 60 * 1000;
const staticRoot = resolve(dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 5173);
const memoryCache = new Map();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendCached(response, entry, cacheStatus) {
  response.writeHead(entry.status, {
    "Content-Type": entry.contentType,
    "Content-Length": entry.body.length,
    "Cache-Control": `private, max-age=${Math.floor(airportConfigTtlMs / 1000)}`,
    "X-Source-Url": entry.sourceUrl,
    "X-Proxy-Cache": cacheStatus,
  });
  response.end(entry.body);
}

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end("Invalid URL path");
    return;
  }

  const isRoot = decodedPath === "/";
  const indexPath = resolve(staticRoot, "index.html");
  const relativePath = isRoot ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = resolve(staticRoot, relativePath);
  if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`)) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (!isRoot && filePath === indexPath) {
    response.writeHead(404).end("Not found");
    return;
  }

  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch {
    fileInfo = undefined;
  }

  if (!fileInfo?.isFile()) {
    response.writeHead(isRoot && filePath === indexPath ? 503 : 404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }).end(isRoot && filePath === indexPath ? "Build the frontend with npm run build first." : "Not found");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(500).end("Could not read static file");
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname !== "/api/dfs") {
    await serveStatic(request, response, requestUrl.pathname);
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end("Method not allowed");
    return;
  }

  const path = requestUrl.searchParams.get("path");
  if (!path) {
    response.writeHead(400).end("Missing source path");
    return;
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(path, upstreamOrigin);
  } catch {
    response.writeHead(400).end("Invalid source path");
    return;
  }

  if (sourceUrl.origin !== upstreamOrigin || !allowedPath.test(sourceUrl.pathname)) {
    response.writeHead(400).end("Only DFS AIP paths can be proxied");
    return;
  }

  const cacheKey = sourceUrl.href;
  const cacheable = airportConfigPath.test(sourceUrl.pathname);
  const cached = cacheable ? memoryCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    sendCached(response, cached, "HIT");
    return;
  }

  try {
    const upstream = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(25000),
      headers: { Accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8" },
    });
    const finalUrl = new URL(upstream.url);
    if (finalUrl.origin !== upstreamOrigin || !allowedPath.test(finalUrl.pathname)) {
      response.writeHead(502).end("DFS redirected outside the allowed AIP paths");
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    const entry = {
      status: upstream.status,
      contentType: upstream.headers.get("content-type") ?? "application/octet-stream",
      body,
      sourceUrl: finalUrl.href,
      expiresAt: Date.now() + airportConfigTtlMs,
    };
    if (cacheable && upstream.ok) memoryCache.set(cacheKey, entry);
    response.writeHead(upstream.status, {
      "Content-Type": entry.contentType,
      "Content-Length": body.length,
      "Cache-Control": cacheable ? `private, max-age=${Math.floor(airportConfigTtlMs / 1000)}` : "no-store",
      "X-Source-Url": finalUrl.href,
      ...(cacheable ? { "X-Proxy-Cache": "MISS" } : {}),
    });
    response.end(body);
  } catch (error) {
    response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? `DFS request failed: ${error.message}` : "DFS request failed");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`VFR Chart Desk listening on http://127.0.0.1:${port}`);
});