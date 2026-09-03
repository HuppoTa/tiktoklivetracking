import { detectTopics, extractDates, normalizeText } from "./normalize.js";
export const QUESTION_THRESHOLD = 0.60;
const ASK = /\b(khong|ko|k|sao|gi|nao|bao gio|khi nao|co khong|duoc khong|con khong|the nao|ra sao)\b/;
const REQUEST = /\b(xem giup|xem cho em|coi giup|coi cho|trai bai|xin xem|cho em hoi|chi xem|anh xem)\b/;
const FUTURE = /\b(sap toi|thang toi|nam nay|tuong lai|quay lai|con duyen)\b/;
const NEGATIVE = /^(hi|hello|chao chi|em chao chi|xinh qua|hay qua|dung roi|cam on chi)$/;
export function classifyQuestion(text, { forced = false, system = false } = {}) {
  const raw = String(text ?? "").trim(), normalized = normalizeText(raw), folded = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  if (forced) return { question: true, score: 1, reasons: ["tiktok-question-event"] };
  if (!raw || system) return { question: false, score: 0, reasons: [system ? "system-comment" : "empty"] };
  const reasons = []; let score = 0; const topics = detectTopics(normalized), dates = extractDates(normalized);
  const relationshipAlias=/\b(tcam|tcảm|t\s*\/\s*cảm|t cam|tduyen)\b/u.test(raw.toLowerCase()); const personPattern=dates.length>0&&/[a-zà-ỹ]{2,}\s+[a-zà-ỹ]{2,}/iu.test(raw.slice(0,raw.search(/\d/)));
  if (/[?？]/u.test(raw)) { score += .45; reasons.push("question-mark"); }
  if (ASK.test(normalized)) { score += .35; reasons.push("question-word"); }
  if (REQUEST.test(folded)) { score += .45; reasons.push("request-reading"); }
  if (topics.length) { score += .30; reasons.push(relationshipAlias?"topic:relationship_alias:tcam":`topic:${topics[0]}`); }
  if (FUTURE.test(normalized)) { score += .25; reasons.push("intent:future"); }
  if (dates.length) { score += .20; reasons.push("contains-birth-date"); } if(personPattern){score+=.15;reasons.push("contains-person-pattern");}
  if (NEGATIVE.test(normalized) || /^(?:[^\p{L}\p{N}]|\s)+$/u.test(raw) || /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(raw)) { score = 0; reasons.push("negative:non-question"); }
  score = Math.max(0, Math.min(1, Number(score.toFixed(2)))); return { question: score >= QUESTION_THRESHOLD, score, reasons };
}
export function isQuestion(text, options) { return classifyQuestion(text, options).question; }
