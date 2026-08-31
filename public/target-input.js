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
  return input && input.length <= 24 && /^[a-z0-9._]+$/.test(input) ? input : null;
}
