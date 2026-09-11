import test from "node:test";
import assert from "node:assert/strict";
import { normalizeText } from "../src/normalize.js";
import { classifyQuestion, isQuestion } from "../src/question-detector.js";

test("normalize bỏ dấu, từ đệm và khoảng trắng thừa", () => {
  assert.equal(normalizeText("Chị ơi, xem giúp em   CÔNG VIỆC với ạ!"), "cong viec");
});

test("classifier nhận tarot không dấu hỏi và trả score/reason", () => {
  const samples = ["Lê Minh 03/04/2001 tình cảm sắp tới", "xem giúp em công việc tháng tới", "em và người cũ còn duyên không"];
  for (const sample of samples) { const result = classifyQuestion(sample); assert.equal(result.question, true); assert.ok(result.score >= 0.60); assert.ok(result.reasons.length > 0); }
});

test("classifier loại greeting emoji và ngày sinh đơn lẻ", () => {
  for (const sample of ["hi", "👋✨", "03/04/2001"]) assert.equal(classifyQuestion(sample).question, false);
});

test("TikTok QUESTION_NEW luôn là question", () => {
  const result = classifyQuestion("nội dung mẫu", { forced: true });
  assert.equal(result.question, true); assert.equal(result.score, 1); assert.deepEqual(result.reasons, ["tiktok-question-event"]);
});

test("nhận diện câu hỏi theo dấu hỏi và ngày sinh + chủ đề", () => {
  assert.equal(isQuestion("Bao giờ công việc tốt hơn?"), true);
  assert.equal(isQuestion("Nguyễn An 01/02/2000 tình cảm sắp tới"), true);
  assert.equal(isQuestion("Chào chị"), false);
});
test("classifier chặn câu tình cảm có DOB under-18 và vẫn loại DOB đơn lẻ",()=>{const r=classifyQuestion("Nguyễn Minh Anh 8/1/2010 chuyện tcam sắp tới ạ");assert.equal(r.question,false);assert.ok(r.reasons.includes("blocked:underage-relationship"));assert.equal(classifyQuestion("8/1/2010").question,false);assert.equal(classifyQuestion("tcam hay quá").question,false)});
