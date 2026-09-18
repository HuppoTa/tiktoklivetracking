import { isAbsolute, resolve } from "node:path";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const fail = code => { throw new Error(`LOCAL_${code}`); };

export function localServerArgs(mode) {
  if (!['dev', 'live'].includes(mode)) fail('MODE_REQUIRED');
  return mode === 'dev' ? ['--watch', 'server.js'] : ['server.js'];
}

export function resolveLocalEnvironment(env = process.env) {
  if (env.APP_ENV !== "local" || !["dev", "live"].includes(env.LOCAL_MODE)) fail("MODE_REQUIRED");
  if (env.NODE_ENV === "production") fail("PRODUCTION_BUILD_FORBIDDEN");
  if (!LOCAL_HOSTS.has(env.HOST || "127.0.0.1") || env.ALLOW_REMOTE_ACCESS === "true") fail("LOOPBACK_REQUIRED");
  if (env.DATABASE_URL) fail("DATABASE_FORBIDDEN");
  if (env.REMOTE_BACKEND_MODE === "1" || env.REMOTE_BACKEND_URL) fail("PROXY_FORBIDDEN");
  if (env.API_BASE_URL || env.SOCKET_URL) fail("REMOTE_URL_FORBIDDEN");
  if (env.ALLOW_PRODUCTION_WRITES && env.ALLOW_PRODUCTION_WRITES !== "0") fail("PRODUCTION_WRITES_FORBIDDEN");
  if (!env.DATA_DIR || !isAbsolute(env.DATA_DIR) || resolve(env.DATA_DIR) === "/") fail("DATA_DIR_REQUIRED");
  if (!env.LOCAL_TEST_PASSWORD || env.LOCAL_TEST_PASSWORD.length < 8) fail("TEST_PASSWORD_REQUIRED");
  const mode = env.LOCAL_MODE;
  if (mode === "dev" && env.DISABLE_TIKTOK !== "1") fail("TIKTOK_MUST_BE_DISABLED");
  if (mode === "live" && env.DISABLE_TIKTOK === "1") fail("LIVE_TIKTOK_DISABLED");
  if (env.PRODUCTION_ROOM_STATUS_URL) {
    let statusUrl;
    try { statusUrl = new URL(env.PRODUCTION_ROOM_STATUS_URL); } catch { fail("PRODUCTION_ROOM_STATUS_REQUIRED"); }
    if (statusUrl.protocol !== "https:" || statusUrl.username || statusUrl.password || statusUrl.hash) fail("PRODUCTION_ROOM_STATUS_INVALID");
  }
  return {
    mode, dataDir: resolve(env.DATA_DIR), apiBaseUrl: "", socketUrl: "",
    disableTikTok: mode === "dev", remoteBackendMode: false, autoConnect: false,
    authUsername: "testing", liveTtlMs: 15 * 60_000, maxReconnectAttempts: 3,
    productionRoomStatusUrl: mode === "live" ? env.PRODUCTION_ROOM_STATUS_URL || null : null,
  };
}
