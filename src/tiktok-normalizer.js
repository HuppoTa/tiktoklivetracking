import { normalizeText } from "./normalize.js";
import { isQuestion } from "./question-detector.js";

export function normalizeTikTokEvent(data, now = new Date()) {
  const text = String(data?.comment || data?.content || "").trim();
  if (!text) return null;
  const user = data.user || {};
  const username = String(user.uniqueId || user.displayId || "unknown");
  const userId = String(user.id || user.userId || `legacy:${username}`);
  return {
    id: String(data.msgId || data.common?.msgId || `${now.getTime()}-${Math.random().toString(36).slice(2)}`),
    timestamp: now.toISOString(),
    userId,
    username,
    nickname: String(user.nickname || username || "Unknown"),
    avatar: String(user.profilePicture?.url?.[0] || user.avatarThumb?.urlList?.[0] || ""),
    text,
    normalizedText: normalizeText(text),
    question: isQuestion(text)
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
