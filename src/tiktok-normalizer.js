import { normalizeText } from "./normalize.js";
import { classifyQuestion } from "./question-detector.js";

export function normalizeTikTokEvent(data, now = new Date(), { forcedQuestion = false } = {}) {
  const text = String(data?.comment || data?.content || "").trim();
  if (!text) return null;
  const user = data.user || {};
  const username = String(user.uniqueId || user.displayId || "unknown");
  const userId = String(user.id || user.userId || `legacy:${username}`);
  const classification = classifyQuestion(text, { forced: forcedQuestion });
  const eventTimestampValue = data?.createTime || data?.common?.createTime || data?.timestamp;
  let eventTimestamp = null;
  if (eventTimestampValue) {
    const numeric = Number(eventTimestampValue);
    const parsed = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
    if (Number.isFinite(parsed.getTime())) eventTimestamp = parsed.toISOString();
  }
  return {
    id: String(data.msgId || data.common?.msgId || `${now.getTime()}-${Math.random().toString(36).slice(2)}`),
    timestamp: now.toISOString(), receivedAt: now.toISOString(), eventTimestamp,
    userId,
    username,
    nickname: String(user.nickname || username || "Unknown"),
    avatar: String(user.profilePicture?.url?.[0] || user.avatarThumb?.urlList?.[0] || ""),
    text,
    normalizedText: normalizeText(text),
    question: classification.question, questionScore: classification.score, questionReasons: classification.reasons,
    classification: classification.classification, confidenceScore: classification.confidenceScore, tarotIntentScore: classification.tarotIntentScore,
    detectedTopic: classification.detectedTopic, detectedSubtopics: classification.detectedSubtopics, detectedEntities: classification.detectedEntities,
    matchedSignals: classification.matchedSignals, needsReview: classification.needsReview, rejectionReason: classification.rejectionReason,
    safetyCategory: classification.safetyCategory, classifierVersion: classification.classifierVersion
  };
}

export function normalizeQuestionEvent(data) {
  const details = data?.data || data?.details || data?.questionDetails;
  return {
    ...data,
    user: details?.user || data?.user,
    comment: details?.content || details?.questionText || data?.questionText || "",
    msgId: details?.questionId || data?.common?.msgId
  };
}
