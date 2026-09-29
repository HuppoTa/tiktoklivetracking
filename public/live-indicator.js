export function liveIndicator(status = {}) {
  const state = String(status.state || "idle");
  const confirmed = status.broadcastLive === true || (
    state === "live" && status.connectionState === "LIVE_HEALTHY"
  );

  if (confirmed) return { className: "live", label: "ĐANG LIVE" };
  if (state === "live") return { className: "verifying", label: "ĐANG XÁC MINH LIVE" };
  if (state === "connecting" || state === "reconnecting") return { className: "connecting", label: "KẾT NỐI" };
  return { className: "offline", label: "OFFLINE" };
}
