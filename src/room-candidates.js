const STATUSES = new Set(["new", "active", "expired", "unavailable", "stale", "selected"]);

export function normalizeRoomCandidate(value, now = new Date()) {
  const roomId = String(value?.roomId || "").trim();
  if (!roomId) return null;
  const status = STATUSES.has(value?.status) ? value.status : "new";
  return {
    roomId,
    username: String(value?.username || "").trim(),
    status,
    source: String(value?.source || "resolver"),
    firstSeenAt: value?.firstSeenAt || now.toISOString(),
    lastSeenAt: value?.lastSeenAt || now.toISOString(),
    selectedAt: value?.selectedAt || null,
    lastError: value?.lastError ? String(value.lastError).slice(0, 300) : null,
  };
}

export function upsertRoomCandidate(list, value, now = new Date()) {
  const candidate = normalizeRoomCandidate(value, now);
  if (!candidate) return Array.isArray(list) ? list : [];
  const current = Array.isArray(list) ? list : [];
  const index = current.findIndex(item => String(item?.roomId) === candidate.roomId && String(item?.username || "") === candidate.username);
  if (index < 0) return [...current, candidate].slice(-20);
  const merged = { ...normalizeRoomCandidate(current[index], now), ...candidate, firstSeenAt: current[index].firstSeenAt || candidate.firstSeenAt };
  return current.map((item, itemIndex) => itemIndex === index ? merged : item);
}

export function markRoomCandidate(list, roomId, status, error = null, now = new Date(), username = "") {
  const id = String(roomId || "").trim();
  if (!id) return Array.isArray(list) ? list : [];
  const existing = (Array.isArray(list) ? list : []).find(item => String(item?.roomId) === id && String(item?.username || "") === username);
  return upsertRoomCandidate(list, { ...(existing || {}), username, roomId: id, status, lastError: error, lastSeenAt: now.toISOString() }, now);
}

export function clearRoomCandidates(list, username = "") { return (Array.isArray(list) ? list : []).filter(item => String(item?.username || "") !== username); }

export function roomCandidateStatus(list, roomId, username = "") {
  return (Array.isArray(list) ? list : []).find(item => String(item?.roomId) === String(roomId || "") && String(item?.username || "") === username) || null;
}
