import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = {
  apiBaseUrl: process.env.API_BASE_URL || "",
  socketUrl: process.env.SOCKET_URL || process.env.API_BASE_URL || "",
};

await writeFile(
  join(root, "public", "runtime-config.js"),
  `globalThis.__APP_CONFIG__ = ${JSON.stringify(config)};\n`,
  "utf8",
);
