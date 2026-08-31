import test from "node:test";
import assert from "node:assert/strict";
import { classifySimilarity, hasImportantConflict, similarity } from "../src/similarity.js";

test("câu giống nhau sau khi bỏ từ đệm được xem là trùng", () => {
  assert.equal(classifySimilarity("Chị ơi công việc sắp tới thế nào ạ", "Công việc sắp tới thế nào").kind, "duplicate");
});

test("hai câu có ngày sinh khác nhau không bị gom", () => {
  assert.equal(hasImportantConflict("Nguyễn An 01/02/2000 tình cảm", "Nguyễn An 03/04/2001 tình cảm"), true);
  assert.equal(similarity("Nguyễn An 01/02/2000 tình cảm", "Nguyễn An 03/04/2001 tình cảm"), 0);
});

test("hai câu có tên người liên quan khác nhau không bị gom khi xác định được", () => {
  assert.equal(hasImportantConflict("Nguyễn An 01/02/2000 tình cảm", "Trần Bình 01/02/2000 tình cảm"), true);
});

test("hai chủ đề chính khác nhau không bị gom", () => {
  assert.equal(hasImportantConflict("Nguyễn An 01/02/2000 tình cảm", "Nguyễn An 01/02/2000 công việc"), true);
});
