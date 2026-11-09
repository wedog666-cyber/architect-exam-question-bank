import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual app's event handlers and quiz selection with a minimal DOM.
// This verifies behavior, not browser layout or native checkbox interaction.
const elements = new Map();
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, {
    innerHTML: '', textContent: '', value: '', disabled: false, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    listeners: {}, setAttribute() {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
  });
  return elements.get(selector);
}
const storage = new Map();
const context = vm.createContext({
  document: { querySelector: element, querySelectorAll: () => [] },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  window: { scrollTo() {}, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {} },
  console,
});
const source = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/, '').replace(/init\(\);\s*$/, '');
vm.runInContext(source + '\n globalThis.app = {state, dom, MODES, bindEvents, renderFilters, filteredQuestions, wrongQuestions, getFilterLabel, startQuiz};', context);
const { state, dom, MODES, bindEvents, renderFilters, filteredQuestions, wrongQuestions, getFilterLabel, startQuiz } = context.app;
state.data = JSON.parse(readFileSync(new URL('../docs/data/questions.json', import.meta.url), 'utf8'));
state.questions = state.data.questions;
bindEvents();
renderFilters();
const categories = state.data.metadata.legalCategories;
const technical = categories.find(c => c.name === '建築技術規則');
const accessible = categories.find(c => c.name === '無障礙設施設計規範');
assert.ok(technical && accessible);
const ids = questions => Array.from(questions, q => q.id).sort();
const changeCategory = (code, checked) => dom.legalCategory.listeners.change({ target: { value: code, checked, matches: () => true } });
const changeSubject = value => { dom.subject.value = value; dom.subject.listeners.change(); };
const expected = codes => state.questions.filter(q => codes.includes(q.legalCategoryCode));

assert.equal(filteredQuestions().length, 1680, 'no filters includes all subjects');
changeCategory(technical.code, true);
assert.equal(state.subject, 'legal');
assert.deepEqual(ids(filteredQuestions()), ids(expected([technical.code])));
const originalOptions = dom.legalCategory.innerHTML;
dom.legalCategoryPicker.open = true;
state.year = '114';
changeCategory(accessible.code, true);
assert.equal(state.year, 'all', 'changing categories resets year');
assert.equal(dom.legalCategoryPicker.open, true);
assert.equal(dom.legalCategory.innerHTML, originalOptions, 'checkbox change preserves option DOM and focus');
const combined = expected([technical.code, accessible.code]);
assert.deepEqual(ids(filteredQuestions()), ids(combined), 'multiple categories form a union');
assert.ok(getFilterLabel().includes(technical.name) && getFilterLabel().includes(accessible.name));
assert.match(dom.legalCategorySummary.textContent, /已選 2 種/);

for (const mode of ['quick', 'balanced', 'mock']) {
  startQuiz(mode);
  assert.equal(state.activeQuestions.length, Math.min(MODES[mode].count, combined.length));
  assert.equal(new Set(ids(state.activeQuestions)).size, state.activeQuestions.length);
  assert.ok(state.activeQuestions.every(q => combined.includes(q)), `${mode} stays inside selected categories`);
}

dom.year.value = String(combined[0].year);
dom.year.listeners.change();
assert.deepEqual(ids(filteredQuestions()), ids(combined.filter(q => String(q.year) === dom.year.value)));
state.year = 'all';
const outside = state.questions.find(q => q.subjectCode === 'legal' && !combined.includes(q));
const wrongSample = [expected([technical.code])[0], expected([accessible.code])[0], outside];
storage.set('architectQuiz.wrong.v1', JSON.stringify(Object.fromEntries(wrongSample.map((q, i) => [q.id, { count: i + 1, unit: q.unit }]))));
assert.deepEqual(ids(wrongQuestions()), ids(wrongSample.slice(0, 2)), 'wrong mode respects the category union');
startQuiz('wrong');
assert.deepEqual(ids(state.activeQuestions), ids(wrongSample.slice(0, 2)));

changeCategory(technical.code, false);
assert.deepEqual(ids(filteredQuestions()), ids(expected([accessible.code])), 'unchecking preserves other choices');
changeCategory(accessible.code, false);
assert.equal(filteredQuestions().length, 800, 'no selected category includes all legal questions');
assert.equal(dom.clearLegalCategories.disabled, true);
changeCategory(technical.code, true);
changeCategory(accessible.code, true);
dom.clearLegalCategories.listeners.click();
assert.equal(state.legalCategories.length, 0);
assert.equal(filteredQuestions().length, 800);
changeCategory(technical.code, true);
changeSubject('structure');
assert.equal(state.legalCategories.length, 0);
assert.equal(dom.legalCategory.disabled, true);
assert.equal(dom.legalCategoryPicker.open, false);
assert.equal(filteredQuestions().length, 880);
changeCategory(technical.code, true);
assert.equal(state.legalCategories.length, 0, 'disabled category controls cannot change filters');
changeSubject('legal');
assert.equal(dom.legalCategory.disabled, false);
changeSubject('all');
assert.equal(filteredQuestions().length, 1680);

console.log(`PASS: category union (${combined.length} questions), year filter, four quiz modes, unique questions, deselection, clear and subject switching.`);
