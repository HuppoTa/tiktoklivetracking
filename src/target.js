export const DEFAULT_TARGET = "kathyuyen.ta";
export const TARGET_PATTERN = /^[a-z0-9._]+$/;

export function normalizeTargetInput(value) {
  let input = String(value ?? "").trim().toLowerCase();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    let url;
    try { url = new URL(input); } catch { return null; }
    if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/@([^/]+)(?:\/live)?\/?$/i);
    if (!match) return null;
    input = match[1];
  }
  input = input.replace(/^@/, "");
  return input && input.length <= 24 && TARGET_PATTERN.test(input) ? input : null;
}

export function resolveTarget(envTarget, storedTarget) {
  return normalizeTargetInput(envTarget) || normalizeTargetInput(storedTarget) || DEFAULT_TARGET;
}

export function recentTargets(current = [], username, limit = 5) {
  const normalized = normalizeTargetInput(username);
  const valid = (Array.isArray(current) ? current : []).map(normalizeTargetInput).filter(Boolean);
  return normalized ? [normalized, ...valid.filter(item => item !== normalized)].slice(0, limit) : valid.slice(0, limit);
}
