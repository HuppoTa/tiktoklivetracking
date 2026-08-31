import { detectTopics, extractDates, extractIdentityHint, normalizeText } from "./normalize.js";

export const DUPLICATE_THRESHOLD = 0.85;
export const POSSIBLE_DUPLICATE_THRESHOLD = 0.60;

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function hasImportantConflict(a, b) {
  const datesA = extractDates(a).sort();
  const datesB = extractDates(b).sort();
  if (datesA.length && datesB.length && !sameList(datesA, datesB)) return true;

  const topicsA = detectTopics(a).sort();
  const topicsB = detectTopics(b).sort();
  if (topicsA.length && topicsB.length && !topicsA.some(topic => topicsB.includes(topic))) return true;

  const nameA = extractIdentityHint(a);
  const nameB = extractIdentityHint(b);
  if (nameA && nameB && nameA !== nameB) return true;
  return false;
}

export function similarity(a, b) {
  if (hasImportantConflict(a, b)) return 0;
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  const A = new Set(normalizedA.split(" "));
  const B = new Set(normalizedB.split(" "));
  const intersection = [...A].filter(token => B.has(token)).length;
  return intersection / (A.size + B.size - intersection);
}

export function classifySimilarity(a, b) {
  const score = similarity(a, b);
  return {
    score,
    kind: score >= DUPLICATE_THRESHOLD ? "duplicate" :
      score >= POSSIBLE_DUPLICATE_THRESHOLD ? "possible" : "different"
  };
}
