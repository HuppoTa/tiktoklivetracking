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

  // Legacy threads used a single answered flag.  Keep that flag derived for every
  // existing consumer, while making the individual question item the source of
  // truth for reader actions.
  normalizeQuestionItems(thread) {
    const legacy = {
      id: thread.id,
      text: thread.canonicalText || "",
      rawText: thread.canonicalText || "",
      normalizedText: thread.normalizedText || normalizeText(thread.canonicalText || ""),
      commentIds: [...(thread.commentIds || [])],
      repeatCount: Number(thread.repeatCount || thread.commentIds?.length || 1),
      createdAt: thread.createdAt,
      updatedAt: thread.lastAskedAt || thread.createdAt,
      lastAskedAt: thread.lastAskedAt || thread.createdAt,
      status: thread.answered ? "ANSWERED" : "WAITING",
      answeredAt: thread.answered ? thread.answeredAt || null : null,
      skippedAt: null,
      needsReview: Boolean(thread.needsReview)
    };
    thread.questionItems = (Array.isArray(thread.questionItems) && thread.questionItems.length ? thread.questionItems : [legacy])
      .map(item => ({ ...legacy, ...item, rawText: item.rawText || item.text || legacy.rawText, text: item.text || item.rawText || legacy.text,
        normalizedText: item.normalizedText || normalizeText(item.text || item.rawText || ""), commentIds: [...(item.commentIds || [])],
        repeatCount: Number(item.repeatCount || item.commentIds?.length || 1), updatedAt: item.updatedAt || item.lastAskedAt || item.createdAt || legacy.updatedAt,
        lastAskedAt: item.lastAskedAt || item.updatedAt || item.createdAt || legacy.lastAskedAt,
        status: item.status || (thread.answered ? "ANSWERED" : (item.needsReview ? "NEEDS_REVIEW" : "WAITING")),
        answeredAt: item.answeredAt || (thread.answered ? thread.answeredAt || null : null), skippedAt: item.skippedAt || null,
        needsReview: Boolean(item.needsReview ?? thread.needsReview) }));
    return thread.questionItems;
  }

  syncThreadQuestionState(thread, now = new Date()) {
    const items = this.normalizeQuestionItems(thread);
    const pending = items.filter(item => ["WAITING", "ACTIVE", "NEEDS_REVIEW"].includes(item.status));
    const active = pending.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0] || null;
    for (const item of items) if (item.status === "ACTIVE" && item !== active) item.status = "WAITING";
    if (active && active.status === "WAITING") active.status = "ACTIVE";
    thread.activeQuestionId = active?.id || null;
    thread.answered = !active;
    thread.answeredAt = thread.answered ? (thread.answeredAt || now.toISOString()) : null;
    thread.canonicalText = active?.text || items[0]?.text || thread.canonicalText;
    thread.normalizedText = active?.normalizedText || items[0]?.normalizedText || thread.normalizedText;
    return active;
  }

  activeQuestion(thread) {
    const active = this.syncThreadQuestionState(thread);
    return active ? { ...active } : null;
  }

  addComment(comment) {
    if (!comment?.sessionId || !comment?.targetUsername) throw new Error("COMMENT_SESSION_REQUIRED");
    if (this.store.comments.some(item => item.id === comment.id && item.sessionId === comment.sessionId)) {
      return { duplicateMessage: true, comment: null, thread: null, threadCreated: false };
    }
    this.store.comments.push(comment);
    if (!comment.question) return { duplicateMessage: false, comment, thread: null, threadCreated: false };

    const candidates = this.store.questionThreads.filter(thread => thread.userId === comment.userId && thread.sessionId === comment.sessionId && !thread.deleted && !thread.archived);
    const thread = candidates.sort((a,b) => Number(a.queueNumber) - Number(b.queueNumber) || String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    if (thread) {
      this.normalizeQuestionItems(thread);
      let item = null; let best = -1;
      for (const candidate of thread.questionItems) { const result = classifySimilarity(comment.normalizedText, candidate.normalizedText); if (result.kind === "duplicate" && result.score > best) { item = candidate; best = result.score; } }
      const isNewQuestion = !item;
      if (!item) { item = { id: `qi-${randomUUID()}`, text: comment.text, rawText: comment.text, normalizedText: comment.normalizedText, commentIds: [], repeatCount: 0, createdAt: comment.timestamp, updatedAt: comment.timestamp, lastAskedAt: comment.timestamp, status: comment.needsReview ? "NEEDS_REVIEW" : "WAITING", answeredAt: null, skippedAt: null, needsReview: Boolean(comment.needsReview) }; thread.questionItems.push(item); }
      if (!item.commentIds.includes(comment.id)) item.commentIds.push(comment.id);
      item.repeatCount = item.commentIds.length; item.lastAskedAt = comment.timestamp; item.updatedAt = comment.timestamp;
      if (!thread.commentIds.includes(comment.id)) thread.commentIds.push(comment.id);
      thread.repeatCount = thread.commentIds.length; thread.lastAskedAt = comment.timestamp; thread.username = comment.username; thread.nickname = comment.nickname; thread.avatar = comment.avatar;
      thread.updatedAt = comment.timestamp;
      if (isNewQuestion && thread.answered) thread.answerHistory ||= [], thread.answerHistory.push({ answeredAt: thread.answeredAt, reopenedAt: comment.timestamp });
      this.syncThreadQuestionState(thread, new Date(comment.timestamp));
      return { duplicateMessage: false, comment, thread, threadCreated: false };
    }

    const createdThread = {
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
      possibleDuplicate: null,
      questionItems: [{ id: `qi-${randomUUID()}`, text: comment.text, rawText: comment.text, normalizedText: comment.normalizedText, commentIds: [comment.id], repeatCount: 1, createdAt: comment.timestamp, updatedAt: comment.timestamp, lastAskedAt: comment.timestamp, status: comment.needsReview ? "NEEDS_REVIEW" : "ACTIVE", answeredAt: null, skippedAt: null, needsReview: Boolean(comment.needsReview) }],
      ...this.queueFields(comment)
    };
    this.syncThreadQuestionState(createdThread, new Date(comment.timestamp));
    this.store.questionThreads.push(createdThread);
    return { duplicateMessage: false, comment, thread: createdThread, threadCreated: true };
  }

  getQuestions({ answered, sort = "queue", search = "", sessionId } = {}) {
    let rows = this.store.questionThreads.filter(thread => thread.deleted !== true && thread.archived !== true);
    if (sessionId) rows = rows.filter(thread => thread.sessionId === sessionId);
    rows.forEach(thread => this.syncThreadQuestionState(thread));
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
      activeQuestion: this.activeQuestion(thread),
      questionItems: this.normalizeQuestionItems(thread).map(item => ({ ...item, occurrences: (item.commentIds || []).map(id => this.store.comments.find(comment => comment.id === id && comment.sessionId === thread.sessionId)).filter(Boolean) })),
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
      const threads = scopedThreads.filter(thread => thread.userId === userId); threads.forEach(thread => this.syncThreadQuestionState(thread)); const items = threads.flatMap(thread => this.normalizeQuestionItems(thread)); const occurrences = items.reduce((sum, item) => sum + Number(item.repeatCount || item.commentIds?.length || 1), 0);
      const latest = comments.at(-1) || threads.at(-1) || {};
      return {
        userId,
        username: latest.username || "unknown",
        nickname: latest.nickname || latest.username || "Unknown",
        avatar: latest.avatar || "",
        totalComments: comments.length,
        totalQuestions: occurrences,
        uniqueQuestions: items.length,
        repeatedQuestions: Math.max(0, occurrences - items.length),
        unansweredQuestions: items.filter(item => ["WAITING", "ACTIVE", "NEEDS_REVIEW"].includes(item.status)).length,
        answeredQuestions: items.filter(item => item.status === "ANSWERED").length,
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
    const updatedAt = now.toISOString();
    for (const item of this.normalizeQuestionItems(thread)) {
      if (answered && item.status !== "SKIPPED") { item.status = "ANSWERED"; item.answeredAt = updatedAt; item.updatedAt = updatedAt; }
      if (!answered && item.status === "ANSWERED") { item.status = "WAITING"; item.answeredAt = null; item.updatedAt = updatedAt; }
    }
    thread.updatedAt = updatedAt;
    this.syncThreadQuestionState(thread, now);
    return thread;
  }

  setQuestionItemStatus(threadId, itemId, status, now = new Date()) {
    if (!['ANSWERED', 'SKIPPED', 'WAITING'].includes(status)) throw new Error("INVALID_QUESTION_STATUS");
    const thread = this.store.questionThreads.find(item => item.id === threadId);
    if (!thread) return null;
    const item = this.normalizeQuestionItems(thread).find(candidate => candidate.id === itemId);
    if (!item) return null;
    item.status = status;
    item.updatedAt = now.toISOString();
    item.answeredAt = status === "ANSWERED" ? now.toISOString() : null;
    item.skippedAt = status === "SKIPPED" ? now.toISOString() : null;
    if (status === "WAITING") { item.answeredAt = null; item.skippedAt = null; }
    thread.updatedAt = now.toISOString();
    this.syncThreadQuestionState(thread, now);
    return thread;
  }

  setUserAnswered(userId, answered, now = new Date(), sessionId) {
    const threads = this.store.questionThreads.filter(thread => thread.userId === userId && (!sessionId || thread.sessionId === sessionId));
    const answeredAt = answered ? now.toISOString() : null;
    for (const thread of threads) {
      for (const item of this.normalizeQuestionItems(thread)) {
        if (answered && item.status !== "SKIPPED") { item.status = "ANSWERED"; item.answeredAt = answeredAt; item.updatedAt = now.toISOString(); }
        if (!answered && item.status === "ANSWERED") { item.status = "WAITING"; item.answeredAt = null; item.updatedAt = now.toISOString(); }
      }
      thread.updatedAt = now.toISOString();
      this.syncThreadQuestionState(thread, now);
    }
    return threads;
  }

  findDuplicate(comment) {
    let best = null;
    for (const thread of this.store.questionThreads.filter(item => !item.archived && item.sessionId === comment.sessionId && item.userId === comment.userId)) {
      for (const item of this.normalizeQuestionItems(thread)) {
        const result = classifySimilarity(comment.normalizedText, item.normalizedText);
        if (result.kind !== "new" && (!best || result.score > best.score)) best = { thread, item, score: result.score, kind: result.kind };
      }
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
      const item = duplicate.item || this.normalizeQuestionItems(duplicate.thread)[0];
      if (!item.commentIds.includes(comment.id)) item.commentIds.push(comment.id);
      item.repeatCount = item.commentIds.length; item.lastAskedAt = comment.timestamp; item.updatedAt = now.toISOString();
      duplicate.thread.lastAskedAt = comment.timestamp; comment.manuallyPromoted = true; comment.manuallyPromotedAt = now.toISOString(); comment.manuallyPromotedReason = reason;
      this.syncThreadQuestionState(duplicate.thread, now);
      return { thread: duplicate.thread, created: false, idempotent: false };
    }
    const thread = { id: `qt-${randomUUID()}`, sessionId, targetUsername: comment.targetUsername, userId: comment.userId,
      username: comment.username, nickname: comment.nickname, avatar: comment.avatar, canonicalText: comment.text,
      normalizedText: comment.normalizedText || normalizeText(comment.text), commentIds: [comment.id], repeatCount: 1,
      answered: false, answeredAt: null, createdAt: comment.timestamp, lastAskedAt: comment.timestamp,
      possibleDuplicate: duplicate ? { threadId: duplicate.thread.id, score: Number(duplicate.score.toFixed(3)) } : null,
      questionItems: [{ id: `qi-${randomUUID()}`, text: comment.text, rawText: comment.text, normalizedText: comment.normalizedText || normalizeText(comment.text), commentIds: [comment.id], repeatCount: 1, createdAt: comment.timestamp, updatedAt: comment.timestamp, lastAskedAt: comment.timestamp, status: "ACTIVE", answeredAt: null, skippedAt: null, needsReview: false }],
      ...this.queueFields(comment, "promoted_comment", now), reason };
    this.syncThreadQuestionState(thread, now);
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
      const item = duplicate?.thread?.id === target.id && duplicate.item ? duplicate.item : this.normalizeQuestionItems(target).find(candidate => classifySimilarity(normalizedText, candidate.normalizedText).kind === "duplicate") || this.normalizeQuestionItems(target)[0];
      item.commentIds.push(comment.id); item.repeatCount = item.commentIds.length; item.lastAskedAt = comment.timestamp; item.updatedAt = now.toISOString(); this.syncThreadQuestionState(target, now);
      return { thread: target, created: false, linked: true };
    }
    this.store.comments.push(comment);
    const thread = { id: `qt-${randomUUID()}`, sessionId, targetUsername: comment.targetUsername, userId: manualUserId, username: comment.username,
      nickname: comment.nickname, avatar: comment.avatar, canonicalText: text, normalizedText, commentIds: [comment.id], repeatCount: 1,
      answered: false, answeredAt: null, createdAt: now.toISOString(), lastAskedAt: now.toISOString(), possibleDuplicate: duplicate ? { threadId: duplicate.thread.id, score: Number(duplicate.score.toFixed(3)) } : null,
      questionItems: [{ id: `qi-${randomUUID()}`, text, rawText: text, normalizedText, commentIds: [comment.id], repeatCount: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), lastAskedAt: now.toISOString(), status: "ACTIVE", answeredAt: null, skippedAt: null, needsReview: false }],
      ...this.queueFields(comment, "manual_entry", now), reason, clientRequestId: clientRequestId || null };
    this.syncThreadQuestionState(thread, now);
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
