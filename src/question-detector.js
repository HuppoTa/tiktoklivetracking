import { detectTopics, extractDates, normalizeText } from "./normalize.js";

const QUESTION_WORDS = /\b(bao nhieu|khong|ko|kh|sao|gi|nao|khi nao|may|gia|ship|phi|con|duoc|the nao|tot khong|sap toi)\b/;

export function isQuestion(text) {
  const raw = String(text ?? "").trim();
  const normalized = normalizeText(raw);
  return /[?？]$/.test(raw) || QUESTION_WORDS.test(normalized) ||
    (extractDates(normalized).length > 0 && detectTopics(normalized).length > 0);
}
