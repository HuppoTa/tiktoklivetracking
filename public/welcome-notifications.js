export const WELCOME_VISIBLE_MS = 4500;
export const WELCOME_GAP_MS = 1200;
export const WELCOME_BUFFER_LIMIT = 30;
export const WELCOME_BURST_WINDOW_MS = 1500;
export const WELCOME_GROUP_LIMIT = 3;

export function createWelcomeStore() { return { queue: [], seen: new Set(), dropped: 0 }; }
export function welcomeKey(item) { return `${item?.sessionId || ""}:${item?.userId || ""}`; }
export function addWelcome(store, item, now = Date.now()) {
  if (!item?.sessionId || !item?.userId || !item?.displayName) return false;
  const key = welcomeKey(item); if (store.seen.has(key)) return false;
  store.seen.add(key); if (store.seen.size > 5_000) store.seen = new Set([...store.seen].slice(-2_500));
  if (store.queue.length >= WELCOME_BUFFER_LIMIT) { store.dropped += 1; return false; }
  store.queue.push({ ...item, receivedAt: now }); return true;
}
export function takeWelcomeBurst(store) {
  const first = store.queue.shift(); if (!first) return null;
  const group = [first];
  while (store.queue.length && store.queue[0].receivedAt - first.receivedAt <= WELCOME_BURST_WINDOW_MS) group.push(store.queue.shift());
  const visible = group.slice(0, WELCOME_GROUP_LIMIT);
  return { primary: first, names: visible.map(item => item.displayName), extraCount: Math.max(0, group.length - visible.length), hasQuestion: group.some(item => item.hasQuestion), hasGift: group.some(item => item.hasGift) };
}
export function clearWelcomeStore(store) { store.queue = []; store.seen.clear(); store.dropped = 0; }
