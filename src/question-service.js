import { randomUUID } from "node:crypto";
import { normalizeText } from "./normalize.js";
import { classifySimilarity } from "./similarity.js";
import { compareGiftPriority } from "./gift-service.js";

export class QuestionService {
  constructor(store) {
    this.store = store;
  }

  session(sessionId) { return this.store.sessions?.find(item => item.id === sessionId) || null; }
  allocateQueueNumber(sessionId) {
    this.store.sessions ||= []; let session = this.session(sessionId);
    if (!session) { session = { id: sessionId, nextQueueNumber: 1 }; this.store.sessions.push(session); }
    const used = this.store.questionThreads.filter(item => item.sessionId === sessionId).map(item => Number(item.queueNumber) || 0);
    const number = Math.max(Number(session.nextQueueNumber) || 1, Math.max(0, ...used) + 1);
    session.nextQueueNumber = number + 1; return number;
  }
  queueFields(comment, source = "classifier", now = new Date()) {
    const queueNumber = this.allocateQueueNumber(comment.sessionId);
    return { source, manualOverride: source !== "classifier", reason: null, queueNumber, priorityRank: queueNumber,
      addedToQueueAt: now.toISOString(), createdBy: source === "classifier" ? "system" : "operator", archived: false };
  }

  addComment(comment) {
    if (!comment?.sessionId || !comment?.targetUsername) throw new Error("COMMENT_SESSION_REQUIRED");
    if (this.store.comments.some(item => item.id === comment.id && item.sessionId === comment.sessionId)) {
      return { duplicateMessage: true, comment: null, thread: null, threadCreated: false };
    }
    this.store.comments.push(comment);
    if (!comment.question) return { duplicateMessage: false, comment, thread: null, threadCreated: false };

    const candidates = this.store.questionThreads.filter(thread => thread.userId === comment.userId && thread.sessionId === comment.sessionId);
    let duplicate = null;
    let possible = null;
    for (const thread of candidates) {
      const result = classifySimilarity(comment.normalizedText, thread.normalizedText);
      if (!duplicate || result.score > duplicate.score) {
        if (result.kind === "duplicate") duplicate = { thread, score: result.score };
      }
      if (result.kind === "possible" && (!possible || result.score > possible.score)) {
        possible = { thread, score: result.score };
      }
    }

    if (duplicate) {
      const thread = duplicate.thread;
      if (!thread.commentIds.includes(comment.id)) thread.commentIds.push(comment.id);
      thread.repeatCount = thread.commentIds.length;
      thread.lastAskedAt = comment.timestamp;
      thread.username = comment.username;
      thread.nickname = comment.nickname;
      return { duplicateMessage: false, comment, thread, threadCreated: false };
    }

    const thread = {
      id: `qt-${randomUUID()}`,
      sessionId: comment.sessionId,
      targetUsername: comment.targetUsername,
      userId: comment.userId,
      username: comment.username,
      nickname: comment.nickname,
      avatar: comment.avatar,
      canonicalText: comment.text,
      normalizedText: normalizeText(comment.text),
      commentIds: [comment.id],
      repeatCount: 1,
      answered: false,
      answeredAt: null,
      createdAt: comment.timestamp,
      lastAskedAt: comment.timestamp,
      possibleDuplicate: possible ? { threadId: possible.thread.id, score: Number(possible.score.toFixed(3)) } : null,
      ...this.queueFields(comment)
    };
    this.store.questionThreads.push(thread);
    return { duplicateMessage: false, comment, thread, threadCreated: true };
  }

  getQuestions({ answered, sort = "queue", search = "", sessionId } = {}) {
    let rows = this.store.questionThreads.filter(thread => thread.deleted !== true && thread.archived !== true);
    if (sessionId) rows = rows.filter(thread => thread.sessionId === sessionId);
    if (typeof answered === "boolean") rows = rows.filter(thread => thread.answered === answered);
    const query = normalizeText(search);
    if (query) rows = rows.filter(thread => normalizeText(`${thread.canonicalText} ${thread.nickname} ${thread.username}`).includes(query));
    if (sort === "queue") rows.sort((a, b) => compareGiftPriority(a, b, this.store.giftSettings));
    else if (sort === "repeats") rows.sort((a, b) => b.repeatCount - a.repeatCount || b.lastAskedAt.localeCompare(a.lastAskedAt));
    else if (sort === "oldest") rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else rows.sort((a, b) => b.lastAskedAt.localeCompare(a.lastAskedAt));
    return rows.map(thread => this.enrichThread(thread));
  }

  enrichThread(thread) {
    return {
      ...thread,
      occurrences: thread.commentIds
        .map(id => this.store.comments.find(comment => comment.id === id && comment.sessionId === thread.sessionId))
        .filter(Boolean)
    };
  }

  getUsers(sessionId) {
    const scopedComments = sessionId ? this.store.comments.filter(comment => comment.sessionId === sessionId) : this.store.comments;
    const scopedThreads = this.store.questionThreads.filter(thread => thread.deleted !== true && (!sessionId || thread.sessionId === sessionId));
    const userIds = new Set([...scopedComments.map(comment => comment.userId), ...scopedThreads.map(thread => thread.userId)]);
    return [...userIds].map(userId => {
      const comments = scopedComments.filter(comment => comment.userId === userId);
      const threads = scopedThreads.filter(thread => thread.userId === userId); const occurrences = threads.reduce((sum, thread) => sum + Number(thread.repeatCount || thread.commentIds?.length || 1), 0);
      const latest = comments.at(-1) || threads.at(-1) || {};
      return {
        userId,
        username: latest.username || "unknown",
        nickname: latest.nickname || latest.username || "Unknown",
        avatar: latest.avatar || "",
        totalComments: comments.length,
        totalQuestions: occurrences,
        uniqueQuestions: threads.length,
        repeatedQuestions: Math.max(0, occurrences - threads.length),
        unansweredQuestions: threads.filter(thread => !thread.answered).length,
        answeredQuestions: threads.filter(thread => thread.answered).length,
        manualQuestions: threads.filter(thread => thread.source === "manual_entry").length,
        promotedQuestions: threads.filter(thread => thread.source === "promoted_comment").length
      };
    }).filter(user => user.uniqueQuestions > 0)
      .sort((a, b) => b.unansweredQuestions - a.unansweredQuestions || b.totalQuestions - a.totalQuestions);
  }

  getUserQuestions(userId, sessionId) {
    return this.store.questionThreads.filter(thread => thread.deleted !== true && thread.userId === userId && (!sessionId || thread.sessionId === sessionId)).map(thread => this.enrichThread(thread));
  }

  setThreadAnswered(threadId, answered, now = new Date()) {
    const thread = this.store.questionThreads.find(item => item.id === threadId);
    if (!thread) return null;
    thread.answered = answered;
    thread.answeredAt = answered ? now.toISOString() : null;
    return thread;
  }

  setUserAnswered(userId, answered, now = new Date(), sessionId) {
    const threads = this.store.questionThreads.filter(thread => thread.userId === userId && (!sessionId || thread.sessionId === sessionId));
    const answeredAt = answered ? now.toISOString() : null;
    for (const thread of threads) {
      thread.answered = answered;
      thread.answeredAt = answeredAt;
    }
    return threads;
  }

  findDuplicate(comment) {
    let best = null;
    for (const thread of this.store.questionThreads.filter(item => !item.archived && item.sessionId === comment.sessionId && item.userId === comment.userId)) {
      const result = classifySimilarity(comment.normalizedText, thread.normalizedText);
      if (result.kind !== "new" && (!best || result.score > best.score)) best = { thread, score: result.score, kind: result.kind };
    }
    return best;
  }

  promoteComment(commentId, sessionId, reason = null, now = new Date()) {
    const comment = this.store.comments.find(item => item.id === commentId && item.sessionId === sessionId);
    if (!comment) return null;
    const linked = this.store.questionThreads.find(item => item.sessionId === sessionId && item.commentIds?.includes(commentId));
    if (linked) return { thread: linked, created: false, idempotent: true };
    const duplicate = this.findDuplicate(comment);
    if (duplicate?.kind === "duplicate") {
      duplicate.thread.commentIds.push(comment.id); duplicate.thread.repeatCount = duplicate.thread.commentIds.length;
      duplicate.thread.lastAskedAt = comment.timestamp; comment.manuallyPromoted = true; comment.manuallyPromotedAt = now.toISOString(); comment.manuallyPromotedReason = reason;
      return { thread: duplicate.thread, created: false, idempotent: false };
    }
    const thread = { id: `qt-${randomUUID()}`, sessionId, targetUsername: comment.targetUsername, userId: comment.userId,
      username: comment.username, nickname: comment.nickname, avatar: comment.avatar, canonicalText: comment.text,
      normalizedText: comment.normalizedText || normalizeText(comment.text), commentIds: [comment.id], repeatCount: 1,
      answered: false, answeredAt: null, createdAt: comment.timestamp, lastAskedAt: comment.timestamp,
      possibleDuplicate: duplicate ? { threadId: duplicate.thread.id, score: Number(duplicate.score.toFixed(3)) } : null,
      ...this.queueFields(comment, "promoted_comment", now), reason };
    comment.manuallyPromoted = true; comment.manuallyPromotedAt = now.toISOString(); comment.manuallyPromotedReason = reason;
    this.store.questionThreads.push(thread); return { thread, created: true, idempotent: false };
  }

  createManual({ sessionId, userId, username, nickname, text, reason = null, duplicateAction, targetThreadId, clientRequestId }, now = new Date()) {
    if (clientRequestId) { const retried = this.store.questionThreads.find(item => item.sessionId === sessionId && item.clientRequestId === clientRequestId); if (retried) return { thread: retried, created: false, linked: false, idempotent: true }; }
    const normalizedText = normalizeText(text); const existingComment = this.store.comments.filter(item => item.sessionId === sessionId && item.userId === userId).at(-1);
    const id = `manual-occurrence:${randomUUID()}`; const manualUserId = userId || `manual-user:${sessionId}:${randomUUID()}`;
    const comment = { id, sessionId, targetUsername: this.session(sessionId)?.targetUsername, roomId: this.session(sessionId)?.roomId || null,
      connectionGeneration: 0, userId: manualUserId, username: username || existingComment?.username || "manual",
      nickname: nickname || existingComment?.nickname || username || "Khách nhập tay", avatar: existingComment?.avatar || "", text,
      normalizedText, question: false, questionScore: 0, questionReasons: [], eventTimestamp: null, receivedAt: now.toISOString(), timestamp: now.toISOString(), source: "manual_entry" };
    const duplicate = this.findDuplicate(comment);
    if (duplicate && !duplicateAction) return { suggestion: { threadId: duplicate.thread.id, kind: duplicate.kind, score: Number(duplicate.score.toFixed(3)) } };
    if (duplicateAction === "link_existing") {
      const target = this.store.questionThreads.find(item => item.id === (targetThreadId || duplicate?.thread.id) && item.sessionId === sessionId && item.userId === manualUserId);
      if (!target) throw new Error("DUPLICATE_TARGET_INVALID");
      this.store.comments.push(comment); target.commentIds.push(comment.id); target.repeatCount = target.commentIds.length; target.lastAskedAt = comment.timestamp;
      return { thread: target, created: false, linked: true };
    }
    this.store.comments.push(comment);
    const thread = { id: `qt-${randomUUID()}`, sessionId, targetUsername: comment.targetUsername, userId: manualUserId, username: comment.username,
      nickname: comment.nickname, avatar: comment.avatar, canonicalText: text, normalizedText, commentIds: [comment.id], repeatCount: 1,
      answered: false, answeredAt: null, createdAt: now.toISOString(), lastAskedAt: now.toISOString(), possibleDuplicate: duplicate ? { threadId: duplicate.thread.id, score: Number(duplicate.score.toFixed(3)) } : null,
      ...this.queueFields(comment, "manual_entry", now), reason, clientRequestId: clientRequestId || null };
    this.store.questionThreads.push(thread); return { thread, created: true, linked: false };
  }

  updatePriority(threadId, sessionId, action) {
    const thread = this.store.questionThreads.find(item => item.id === threadId && item.sessionId === sessionId && !item.archived); if (!thread) return null;
    const rows = this.store.questionThreads.filter(item => item.sessionId === sessionId && !item.archived && !item.answered)
      .sort((a,b) => (a.priorityRank ?? a.queueNumber) - (b.priorityRank ?? b.queueNumber));
    const index = rows.indexOf(thread);
    if (action === "move_up" && index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
    else if (action === "move_down" && index >= 0 && index < rows.length - 1) [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]];
    else if (action === "move_to_top" && index > 0) rows.unshift(...rows.splice(index, 1));
    else if (action === "reset") rows.sort((a,b) => a.queueNumber - b.queueNumber);
    else if (!['move_up','move_down','move_to_top','reset'].includes(action)) throw new Error("INVALID_PRIORITY_ACTION");
    rows.forEach((item, position) => { item.priorityRank = position + 1; }); return thread;
  }

  setPinned(threadId, sessionId, pinned) {
    const thread = this.store.questionThreads.find(item => item.id === threadId && item.sessionId === sessionId && !item.archived && !item.deleted);
    if (!thread) return null;
    thread.manualPinned = pinned;
    thread.manualPinnedAt = pinned ? new Date().toISOString() : null;
    return thread;
  }

  archive(threadId, sessionId, archived = true) {
    const thread = this.store.questionThreads.find(item => item.id === threadId && item.sessionId === sessionId); if (!thread) return null;
    thread.archived = archived; thread.archivedAt = archived ? new Date().toISOString() : null; return thread;
  }
}
