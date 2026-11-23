// Tiny static server for local development: `node serve.mjs` → http://localhost:8000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json", ".svg": "image/svg+xml" };
const root = process.cwd(), port = +(process.env.PORT ?? 8000);
createServer(async (req, res) => {
  let path;
  try { path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, ""); }
  catch { res.writeHead(400).end("bad request"); return; }
  const file = join(root, path.endsWith("/") ? path + "index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
