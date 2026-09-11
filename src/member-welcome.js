const safeText = (value, limit = 100) => String(value ?? "").trim().slice(0, limit);

export function buildWelcomeMemberPayload({ data, session, welcomedUserIds = [], threads = [], gifts = [], now = new Date() }) {
  const user = data?.user || {};
  const userId = safeText(user.id || user.userId || data?.userId, 120);
  if (!userId) return { payload: null, reason: "MISSING_MEMBER_IDENTITY" };
  if (welcomedUserIds.map(String).includes(userId)) return { payload: null, reason: "DUPLICATE_MEMBER_IN_SESSION" };
  const nickname = safeText(user.nickname || user.nickName, 100);
  const uniqueId = safeText(user.uniqueId || user.unique_id || data?.uniqueId, 100);
  const displayName = nickname || uniqueId || "Khách mới";
  return {
    payload: {
      sessionId: session.id,
      roomId: session.roomId || null,
      connectionGeneration: session.connectionGeneration,
      userId,
      nickname: nickname || null,
      uniqueId: uniqueId || null,
      displayName,
      joinedAt: now.toISOString(),
      hasQuestion: threads.some(thread => thread.sessionId === session.id && thread.userId === userId && !thread.deleted && !thread.archived),
      hasGift: gifts.some(gift => gift.sessionId === session.id && gift.userId === userId)
    },
    reason: null
  };
}
