import fs from 'node:fs';
import assert from 'node:assert/strict';
import { installExplanations, renderExplanation } from '../docs/explanations.mjs';

const questions = JSON.parse(fs.readFileSync('docs/data/questions.json', 'utf8')).questions;
const payload = JSON.parse(fs.readFileSync('docs/data/explanations.json', 'utf8'));
installExplanations(payload);
assert.equal(Object.keys(payload.explanations).length, questions.length);
let renders = 0;
for (const q of questions) {
  const note = payload.explanations[q.id];
  assert.ok(note, `Missing ${q.id}`);
  assert.deepEqual(note.acceptedAnswers, q.acceptedAnswers, q.id);
  for (const answer of [undefined, 'A', 'B', 'C', 'D']) {
    const correct = q.acceptedAnswers.includes(answer);
    const html = renderExplanation(q, answer, correct);
    assert.ok(html.includes('<summary>答案解析</summary>'), q.id);
    assert.ok(html.includes('判斷理由'), q.id);
    assert.ok(!html.includes('詳細解析待補'), q.id);
    assert.equal(html.startsWith('<details class="review-explanation" open>'), !correct, q.id);
    assert.equal((html.match(/class="review-option(?: |")/g) || []).length, 4, q.id);
    if (q.acceptedAnswers.length === 4) assert.ok(html.includes('各選項給分'), q.id);
    else if (q.acceptedAnswers.length > 1) assert.ok(html.includes(`本題接受 ${q.acceptedAnswers.join('、')}`), q.id);
    if (note.currentNote) assert.ok(html.includes('現行規定／補充'), q.id);
    renders++;
  }
}
const sample = questions.find(q => q.acceptedAnswers.length === 1);
const note = payload.explanations[sample.id];
// A later answer-key correction must never silently display an incompatible rationale.
const changedKey = ['A', 'B', 'C', 'D'].filter(k => !sample.acceptedAnswers.includes(k)).slice(0, 1);
assert.ok(renderExplanation({ ...sample, acceptedAnswers: changedKey }, changedKey[0], true).includes('詳細解析待補'));
// Editorial text and source labels must remain text, even if they contain HTML.
installExplanations({ explanations: { [sample.id]: { ...note, text: '<script>bad()</script>', sources: [{title: '<img src=x>', url: 'https://example.org/?q="x"'}, {title:'bad',url:'javascript:bad()'}] } } });
const escaped = renderExplanation(sample, undefined, false);
assert.ok(!escaped.includes('<script>') && !escaped.includes('<img') && !escaped.includes('javascript:'));
assert.ok(escaped.includes('&lt;script&gt;'));
installExplanations(payload);
console.log(JSON.stringify({ questions: questions.length, answerStatesRendered: renders, answerCorrectionGuard: 'passed', safeTextAndLinks: 'passed', statuses: payload.metadata.statuses }, null, 2));
