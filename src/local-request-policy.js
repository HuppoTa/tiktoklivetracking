const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const LOCAL_LIFECYCLE = new Set(["/api/connect", "/api/disconnect", "/api/collector/reconnect", "/api/target", "/api/sessions/start", "/api/room-candidates/clear", "/api/room-candidates/refresh", "/api/room-candidates/select"]);

export function remoteProxyPolicy(method) {
  return MUTATING_METHODS.has(String(method).toUpperCase()) ? "PRODUCTION_PROXY_READ_ONLY" : null;
}

export function localActionPolicy(mode, method, path) {
  if (String(method).toUpperCase() !== "POST") return null;
  if (mode === "dev" && (LOCAL_LIFECYCLE.has(path) || /^\/api\/sessions\/[^/]+\/end$/.test(path))) return "LOCAL_GUARDED_ACTION_ONLY";
  if (mode === "live" && ["/api/connect", "/api/target", "/api/sessions/start", "/api/room-candidates/clear", "/api/room-candidates/refresh", "/api/room-candidates/select"].includes(path)) return "LOCAL_GUARDED_ACTION_ONLY";
  return null;
}
