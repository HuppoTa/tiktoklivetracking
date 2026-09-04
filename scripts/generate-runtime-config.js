import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const productionBackend = "https://tiktoklivetracking-api.onrender.com";
const defaultBackend = process.env.VERCEL ? productionBackend : "";
const config = {
  apiBaseUrl: process.env.API_BASE_URL || defaultBackend,
  socketUrl: process.env.SOCKET_URL || process.env.API_BASE_URL || defaultBackend,
};

await writeFile(
  join(root, "public", "runtime-config.js"),
  `globalThis.__APP_CONFIG__ = ${JSON.stringify(config)};\n`,
  "utf8",
);

await mkdir(join(root, "public", "vendor"), { recursive: true });
await copyFile(
  join(root, "node_modules", "socket.io-client", "dist", "socket.io.min.js"),
  join(root, "public", "vendor", "socket.io.min.js"),
);
