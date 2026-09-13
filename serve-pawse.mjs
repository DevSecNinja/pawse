import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";

export async function startServer(port = 0) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Port must be an integer between 0 and 65535 (0 selects an available port).");
  }
  const html = await readFile(new URL("./index.html", import.meta.url));
  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/favicon.ico" || pathname === "/pawse/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (!["/", "/index.html", "/pawse/", "/pawse/index.html"].includes(pathname)) {
      response.writeHead(404);
      response.end(request.method === "HEAD" ? undefined : "Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : html);
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return server;
}

if (import.meta.main) {
  const server = await startServer(Number(process.argv[2] ?? 0));
  console.log(`Pawse mockup: http://127.0.0.1:${server.address().port}/`);
}
