import { randomUUID } from "node:crypto";
import { normalizeText } from "./normalize.js";
import { classifySimilarity } from "./similarity.js";

export class QuestionService {
  constructor(store) {
    this.store = store;
  }

  addComment(comment) {
    if (this.store.comments.some(item => item.id === comment.id)) {
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
      possibleDuplicate: possible ? { threadId: possible.thread.id, score: Number(possible.score.toFixed(3)) } : null
    };
    this.store.questionThreads.push(thread);
    return { duplicateMessage: false, comment, thread, threadCreated: true };
  }

  getQuestions({ answered, sort = "latest", search = "", sessionId } = {}) {
    let rows = [...this.store.questionThreads];
    if (sessionId) rows = rows.filter(thread => thread.sessionId === sessionId);
    if (typeof answered === "boolean") rows = rows.filter(thread => thread.answered === answered);
    const query = normalizeText(search);
    if (query) rows = rows.filter(thread => normalizeText(`${thread.canonicalText} ${thread.nickname} ${thread.username}`).includes(query));
    if (sort === "repeats") rows.sort((a, b) => b.repeatCount - a.repeatCount || b.lastAskedAt.localeCompare(a.lastAskedAt));
    else if (sort === "oldest") rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else rows.sort((a, b) => b.lastAskedAt.localeCompare(a.lastAskedAt));
    return rows.map(thread => this.enrichThread(thread));
  }

  enrichThread(thread) {
    return {
      ...thread,
      occurrences: thread.commentIds
        .map(id => this.store.comments.find(comment => comment.id === id))
        .filter(Boolean)
    };
  }

  getUsers(sessionId) {
    const scopedComments = sessionId ? this.store.comments.filter(comment => comment.sessionId === sessionId) : this.store.comments;
    const userIds = new Set(scopedComments.map(comment => comment.userId));
    return [...userIds].map(userId => {
      const comments = scopedComments.filter(comment => comment.userId === userId);
      const questions = comments.filter(comment => comment.question);
      const threads = this.store.questionThreads.filter(thread => thread.userId === userId && (!sessionId || thread.sessionId === sessionId));
      const latest = comments.at(-1) || {};
      return {
        userId,
        username: latest.username || "unknown",
        nickname: latest.nickname || latest.username || "Unknown",
        avatar: latest.avatar || "",
        totalComments: comments.length,
        totalQuestions: questions.length,
        uniqueQuestions: threads.length,
        repeatedQuestions: Math.max(0, questions.length - threads.length),
        unansweredQuestions: threads.filter(thread => !thread.answered).length
      };
    }).filter(user => user.totalQuestions > 0)
      .sort((a, b) => b.unansweredQuestions - a.unansweredQuestions || b.totalQuestions - a.totalQuestions);
  }

  getUserQuestions(userId, sessionId) {
    return this.store.questionThreads.filter(thread => thread.userId === userId && (!sessionId || thread.sessionId === sessionId)).map(thread => this.enrichThread(thread));
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
}
