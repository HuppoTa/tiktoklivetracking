import test from "node:test";
import assert from "node:assert/strict";
import { normalizeText } from "../src/normalize.js";
import { isQuestion } from "../src/question-detector.js";

test("normalize bỏ dấu, từ đệm và khoảng trắng thừa", () => {
  assert.equal(normalizeText("Chị ơi, xem giúp em   CÔNG VIỆC với ạ!"), "cong viec");
});

test("nhận diện câu hỏi theo dấu hỏi và ngày sinh + chủ đề", () => {
  assert.equal(isQuestion("Bao giờ công việc tốt hơn?"), true);
  assert.equal(isQuestion("Nguyễn An 01/02/2000 tình cảm sắp tới"), true);
  assert.equal(isQuestion("Chào chị"), false);
});
