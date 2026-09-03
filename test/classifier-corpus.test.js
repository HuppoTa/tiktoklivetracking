import test from "node:test"; import assert from "node:assert/strict"; import { classifyQuestion } from "../src/question-detector.js"; import { classifierCorpus,holdoutCorpus } from "./fixtures/classifier-corpus.js";
const metrics=rows=>{let tp=0,fp=0,fn=0;for(const r of rows){const a=classifyQuestion(r.text).question;if(a&&r.expected)tp++;else if(a)fp++;else if(r.expected)fn++}return{precision:tp/(tp+fp)||0,recall:tp/(tp+fn)||0}};
test("classifier corpus có ít nhất 300 case và holdout riêng",()=>{assert.ok(classifierCorpus.length>=300);assert.ok(holdoutCorpus.length>=60)});
test("classifier giữ precision baseline và recall có kiểm soát trên holdout giả",()=>{const m=metrics(holdoutCorpus);assert.ok(m.precision>=0.95);assert.ok(m.recall>=0.75)});
