const DATA_URL = "data/questions.json";
const STORAGE_KEYS = {
  history: "architectQuiz.history.v1",
  wrong: "architectQuiz.wrong.v1",
};

const MODES = {
  quick: { label: "快速練習", short: "快練", count: 10, timeLimit: null },
  balanced: { label: "均衡抽題", short: "均衡", count: 20, timeLimit: null, balanced: true },
  mock: { label: "年度模擬", short: "模擬", count: 80, timeLimit: 120 * 60 },
  wrong: { label: "錯題複習", short: "錯題", count: 20, timeLimit: null, wrongOnly: true },
};

const state = {
  data: null,
  questions: [],
  mode: "quick",
  subject: "all",
  year: "all",
  activeQuestions: [],
  answers: {},
  flagged: new Set(),
  currentIndex: 0,
  startedAt: 0,
  timerId: null,
  lastResult: null,
  reviewFilter: "all",
  toastId: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dom = {
  home: $("#homeView"),
  quiz: $("#quizView"),
  result: $("#resultView"),
  subject: $("#subjectSelect"),
  year: $("#yearSelect"),
  modeList: $("#modeList"),
  setupForm: $("#quizSetupForm"),
  startButton: $("#startQuizButton"),
  selectionSummary: $("#selectionSummary"),
  heroCount: $("#heroQuestionCount"),
  wrongModeDescription: $("#wrongModeDescription"),
  timerChip: $("#timerChip"),
  timerText: $("#timerText"),
  progressBar: $("#progressBar"),
  questionProgressFill: $("#questionProgressFill"),
  currentQuestionNumber: $("#currentQuestionNumber"),
  totalQuestionNumber: $("#totalQuestionNumber"),
  answeredCount: $("#answeredCount"),
  palette: $("#questionPalette"),
  quizModeLabel: $("#quizModeLabel"),
  quizFilterLabel: $("#quizFilterLabel"),
  questionIndexLabel: $("#questionIndexLabel"),
  questionSubjectTag: $("#questionSubjectTag"),
  largeQuestionNumber: $("#largeQuestionNumber"),
  questionText: $("#questionText"),
  questionOptions: $("#questionOptions"),
  questionImageHint: $("#questionImageHint"),
  sourceButton: $("#sourceButton"),
  flagButton: $("#flagButton"),
  previousButton: $("#prevQuestionButton"),
  nextButton: $("#nextQuestionButton"),
  statCompleted: $("#statCompleted"),
  statAverage: $("#statAverage"),
  statWrong: $("#statWrong"),
  recentHistory: $("#recentHistory"),
  weakUnits: $("#weakUnits"),
  legalCount: $("#legalCount"),
  structureCount: $("#structureCount"),
  resultDate: $("#resultDate"),
  resultScore: $("#resultScore"),
  resultTitle: $("#resultTitle"),
  resultSubtitle: $("#resultSubtitle"),
  resultCorrect: $("#resultCorrect"),
  resultMissed: $("#resultMissed"),
  resultTime: $("#resultTime"),
  resultTimeMeta: $("#resultTimeMeta"),
  reviewList: $("#reviewList"),
  reviewCountLabel: $("#reviewCountLabel"),
  resultUnits: $("#resultUnits"),
  sourceDialog: $("#sourceDialog"),
  sourceDialogTitle: $("#sourceDialogTitle"),
  sourceDialogImage: $("#sourceDialogImage"),
  helpDialog: $("#helpDialog"),
  toast: $("#toast"),
};

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showToast("瀏覽器暫時無法保存紀錄，但本次練習仍可完成。");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function naturalCompare(a, b) {
  const aParts = String(a).match(/[0-9]+|[^0-9]+/g) || [];
  const bParts = String(b).match(/[0-9]+|[^0-9]+/g) || [];
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const left = aParts[index] ?? "";
    const right = bParts[index] ?? "";
    if (/^[0-9]+$/.test(left) && /^[0-9]+$/.test(right)) {
      const difference = Number(left) - Number(right);
      if (difference) return difference;
    } else if (left !== right) {
      return left.localeCompare(right, "zh-Hant");
    }
  }
  return 0;
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function showToast(message) {
  if (state.toastId) window.clearTimeout(state.toastId);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  state.toastId = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 3000);
}

function showView(view) {
  dom.home.hidden = view !== "home";
  dom.quiz.hidden = view !== "quiz";
  dom.result.hidden = view !== "result";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getSubjectName(code) {
  return state.questions.find((question) => question.subjectCode === code)?.subject || "全部科目";
}

function getFilterLabel() {
  const subject = state.subject === "all" ? "全部科目" : getSubjectName(state.subject);
  const year = state.year === "all" ? "不限年度" : `${state.year} 年`;
  return state.year === "all" && state.subject === "all" ? subject : `${subject} · ${year}`;
}

function filteredQuestions() {
  return state.questions.filter((question) => {
    const subjectMatch = state.subject === "all" || question.subjectCode === state.subject;
    const yearMatch = state.year === "all" || String(question.year) === String(state.year);
    return subjectMatch && yearMatch;
  });
}

function wrongMap() {
  const stored = readStorage(STORAGE_KEYS.wrong, {});
  return stored && typeof stored === "object" ? stored : {};
}

function wrongQuestions() {
  const wrong = wrongMap();
  return filteredQuestions()
    .filter((question) => wrong[question.id])
    .sort((a, b) => (wrong[b.id].count || 0) - (wrong[a.id].count || 0) || naturalCompare(a.unit, b.unit));
}

function historyMap() {
  const stored = readStorage(STORAGE_KEYS.history, {});
  return stored && typeof stored === "object" ? stored : {};
}

function allHistory() {
  return Object.values(historyMap()).flatMap((records) => Array.isArray(records) ? records : []).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
}

function renderFilters() {
  const subjects = [...new Map(state.questions.map((question) => [question.subjectCode, question.subject])).entries()];
  dom.subject.innerHTML = `<option value="all">全部科目</option>${subjects.map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(name)}</option>`).join("")}`;
  dom.subject.value = state.subject;
  refreshYears();
}

function refreshYears() {
  const years = [...new Set(filteredQuestions().map((question) => question.year))].sort((a, b) => b - a);
  const yearStillExists = state.year === "all" || years.includes(Number(state.year));
  if (!yearStillExists) state.year = "all";
  dom.year.innerHTML = `<option value="all">不限年度</option>${years.map((year) => `<option value="${year}">${year} 年</option>`).join("")}`;
  dom.year.value = state.year;
}

function setMode(mode) {
  if (!MODES[mode]) return;
  state.mode = mode;
  $$("[data-mode]").forEach((button) => button.classList.toggle("is-selected", button.dataset.mode === mode));
  updateModeAvailability();
}

function updateModeAvailability() {
  const pool = filteredQuestions();
  const wrongCount = wrongQuestions().length;
  $$("[data-mode]").forEach((button) => {
    const mode = MODES[button.dataset.mode];
    const unavailable = (mode.wrongOnly && wrongCount === 0) || (!mode.wrongOnly && pool.length === 0) || (button.dataset.mode === "mock" && pool.length < mode.count);
    button.disabled = unavailable;
    button.setAttribute("aria-disabled", String(unavailable));
  });
  if (MODES[state.mode].wrongOnly && wrongCount === 0) {
    state.mode = "quick";
    $$("[data-mode]").forEach((button) => button.classList.toggle("is-selected", button.dataset.mode === state.mode));
  }
  dom.wrongModeDescription.textContent = wrongCount ? `${wrongCount} 題 · 依錯誤次數排序` : "尚無錯題紀錄";
  const mode = MODES[state.mode];
  const count = mode.wrongOnly ? wrongCount : Math.min(mode.count, pool.length);
  if (mode.wrongOnly) dom.selectionSummary.textContent = count ? `從目前篩選的錯題中挑選 ${count} 題` : "完成一次練習後，錯題會自動收進來";
  else if (mode.balanced) dom.selectionSummary.textContent = `從目前篩選範圍平均抽取 ${count} 題`;
  else if (mode.timeLimit) dom.selectionSummary.textContent = `從目前篩選範圍抽取完整 ${mode.count} 題，限時 120 分鐘`;
  else dom.selectionSummary.textContent = `將從目前篩選範圍隨機抽取 ${count} 題`;
  dom.startButton.disabled = !pool.length || (state.mode === "mock" && pool.length < MODES.mock.count) || (state.mode === "wrong" && !wrongCount);
}

function chooseQuestions(pool, mode) {
  const count = Math.min(mode.count, pool.length);
  if (!mode.balanced) return shuffle(pool).slice(0, count);
  const groups = new Map();
  pool.forEach((question) => {
    if (!groups.has(question.unit)) groups.set(question.unit, []);
    groups.get(question.unit).push(question);
  });
  const units = [...groups.keys()].sort(naturalCompare);
  units.forEach((unit) => groups.set(unit, shuffle(groups.get(unit))));
  const chosen = [];
  const baseQuota = Math.floor(count / Math.max(units.length, 1));
  units.forEach((unit) => chosen.push(...groups.get(unit).splice(0, Math.min(baseQuota, groups.get(unit).length))));
  while (chosen.length < count) {
    const availableUnits = units.filter((unit) => groups.get(unit).length);
    if (!availableUnits.length) break;
    for (const unit of shuffle(availableUnits)) {
      if (chosen.length >= count) break;
      chosen.push(groups.get(unit).pop());
    }
  }
  return shuffle(chosen);
}

function startQuiz(mode = state.mode) {
  state.mode = mode;
  const config = MODES[mode];
  const pool = config.wrongOnly ? wrongQuestions() : filteredQuestions();
  if (!pool.length) {
    showToast(config.wrongOnly ? "目前篩選範圍還沒有錯題。" : "目前篩選範圍沒有題目。");
    return;
  }
  if (config.count > pool.length && mode === "mock") {
    showToast("年度模擬需要至少 80 題，請放寬科目或年度篩選。");
    return;
  }
  state.activeQuestions = chooseQuestions(pool, config);
  state.answers = {};
  state.flagged = new Set();
  state.currentIndex = 0;
  state.startedAt = Date.now();
  clearTimer();
  dom.quizModeLabel.textContent = config.label;
  dom.quizFilterLabel.textContent = config.wrongOnly ? `${getFilterLabel()} · ${pool.length} 題待複習` : getFilterLabel();
  showView("quiz");
  renderQuestion();
  startTimer(config.timeLimit);
}

function clearTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
}

function startTimer(timeLimit) {
  if (!timeLimit) {
    dom.timerChip.hidden = true;
    return;
  }
  dom.timerChip.hidden = false;
  updateTimer(timeLimit);
  state.timerId = window.setInterval(() => updateTimer(timeLimit), 1000);
}

function updateTimer(timeLimit) {
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const remaining = timeLimit - elapsed;
  dom.timerChip.classList.toggle("is-overtime", remaining < 0);
  dom.timerText.textContent = remaining < 0 ? `超時 +${formatTime(Math.abs(remaining))}` : formatTime(remaining);
}

function renderQuestion() {
  const question = state.activeQuestions[state.currentIndex];
  if (!question) return;
  const total = state.activeQuestions.length;
  const position = state.currentIndex + 1;
  const positionLabel = String(position).padStart(2, "0");
  const selected = state.answers[question.id];
  const hasFigure = question.options.some((option) => option.text.startsWith("原卷圖示"));
  dom.currentQuestionNumber.textContent = positionLabel;
  dom.totalQuestionNumber.textContent = String(total).padStart(2, "0");
  dom.answeredCount.textContent = `${Object.keys(state.answers).length} 已作答`;
  dom.questionProgressFill.style.width = `${(position / total) * 100}%`;
  dom.progressBar.style.width = `${(position / total) * 100}%`;
  dom.questionIndexLabel.textContent = `QUESTION ${positionLabel}`;
  dom.questionSubjectTag.textContent = `${question.year} 年 · ${question.subject}`;
  dom.largeQuestionNumber.textContent = positionLabel;
  dom.questionText.textContent = question.questionText;
  dom.flagButton.classList.toggle("is-flagged", state.flagged.has(question.id));
  dom.flagButton.setAttribute("aria-pressed", String(state.flagged.has(question.id)));
  dom.flagButton.innerHTML = `<span aria-hidden="true">${state.flagged.has(question.id) ? "⚑" : "⚐"}</span> ${state.flagged.has(question.id) ? "已標記" : "標記這題"}`;
  dom.sourceButton.hidden = !question.pageImage;
  dom.sourceButton.textContent = `原卷第 ${question.sourcePage} 頁 ↗`;
  dom.questionImageHint.hidden = !hasFigure;
  dom.questionOptions.innerHTML = question.options.map((option) => {
    const isSelected = selected === option.key;
    const isFigure = option.text.startsWith("原卷圖示");
    return `<button class="answer-option${isSelected ? " is-selected" : ""}" type="button" data-answer="${option.key}" role="radio" aria-checked="${isSelected}"><span class="answer-option-key">${option.key}</span><span class="answer-option-text${isFigure ? " is-figure" : ""}">${escapeHtml(option.text)}</span></button>`;
  }).join("");
  $$("#questionOptions .answer-option").forEach((button) => button.addEventListener("click", () => chooseAnswer(button.dataset.answer)));
  dom.previousButton.disabled = state.currentIndex === 0;
  dom.nextButton.innerHTML = state.currentIndex === total - 1 ? `交卷 <span aria-hidden="true">✓</span>` : `下一題 <span aria-hidden="true">→</span>`;
  renderPalette();
}

function chooseAnswer(key) {
  const question = state.activeQuestions[state.currentIndex];
  if (!question) return;
  state.answers[question.id] = key;
  renderQuestion();
}

function renderPalette() {
  dom.palette.innerHTML = state.activeQuestions.map((question, index) => {
    const current = index === state.currentIndex;
    const answered = Boolean(state.answers[question.id]);
    const flagged = state.flagged.has(question.id);
    return `<button class="palette-button${current ? " is-current" : ""}${answered ? " is-answered" : ""}${flagged ? " is-flagged" : ""}" type="button" data-index="${index}" aria-label="第 ${index + 1} 題${answered ? "，已作答" : "，未作答"}">${index + 1}</button>`;
  }).join("");
  $$("#questionPalette .palette-button").forEach((button) => button.addEventListener("click", () => {
    state.currentIndex = Number(button.dataset.index);
    renderQuestion();
  }));
}

function toggleFlag() {
  const question = state.activeQuestions[state.currentIndex];
  if (!question) return;
  if (state.flagged.has(question.id)) state.flagged.delete(question.id);
  else state.flagged.add(question.id);
  renderQuestion();
}

function attemptQuit() {
  const hasProgress = Object.keys(state.answers).length > 0;
  if (hasProgress && !window.confirm("離開後本次未完成的作答不會計入紀錄，確定返回設定嗎？")) return;
  clearTimer();
  showView("home");
  renderHome();
}

function submitQuiz() {
  const unanswered = state.activeQuestions.length - Object.keys(state.answers).length;
  if (unanswered && !window.confirm(`還有 ${unanswered} 題未作答，確定現在交卷嗎？`)) return;
  clearTimer();
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const config = MODES[state.mode];
  const results = state.activeQuestions.map((question) => {
    const answer = state.answers[question.id] || null;
    return {
      question,
      answer,
      correct: Boolean(answer && question.acceptedAnswers.includes(answer)),
    };
  });
  const correct = results.filter((result) => result.correct).length;
  const score = Math.round((correct / results.length) * 100);
  state.lastResult = {
    id: `result-${Date.now()}`,
    mode: state.mode,
    modeLabel: config.label,
    filterLabel: getFilterLabel(),
    total: results.length,
    correct,
    score,
    elapsed,
    overtime: Boolean(config.timeLimit && elapsed > config.timeLimit),
    completedAt: new Date().toISOString(),
    results,
  };
  saveCompletedResult(state.lastResult);
  renderResult();
  showView("result");
}

function saveCompletedResult(result) {
  const history = historyMap();
  const record = {
    id: result.id,
    mode: result.mode,
    modeLabel: result.modeLabel,
    filterLabel: result.filterLabel,
    score: result.score,
    correct: result.correct,
    total: result.total,
    elapsed: result.elapsed,
    overtime: result.overtime,
    wrongCount: result.total - result.correct,
    completedAt: result.completedAt,
  };
  history[result.mode] = [record, ...(Array.isArray(history[result.mode]) ? history[result.mode] : [])].slice(0, 10);
  writeStorage(STORAGE_KEYS.history, history);

  const wrong = wrongMap();
  result.results.filter((item) => !item.correct).forEach(({ question }) => {
    const old = wrong[question.id] || {
      id: question.id,
      subject: question.subject,
      subjectCode: question.subjectCode,
      year: question.year,
      unit: question.unit,
      count: 0,
    };
    wrong[question.id] = { ...old, count: old.count + 1, lastSeen: result.completedAt };
  });
  writeStorage(STORAGE_KEYS.wrong, wrong);
}

function formatAccepted(question) {
  if (question.acceptedAnswers.length === 4) return "各選項均給分";
  return question.acceptedAnswers.join("／");
}

function renderResult() {
  const result = state.lastResult;
  if (!result) return;
  const missed = result.total - result.correct;
  dom.resultDate.textContent = `${new Date(result.completedAt).toLocaleDateString("zh-TW")} · ${result.modeLabel}`;
  dom.resultScore.textContent = `${result.score}%`;
  dom.resultCorrect.textContent = result.correct;
  dom.resultMissed.textContent = missed;
  dom.resultTime.textContent = formatTime(result.elapsed);
  dom.resultTimeMeta.textContent = result.overtime ? "已超過時限" : MODES[result.mode].timeLimit ? "120 分鐘內" : "不限時";
  dom.resultTitle.textContent = result.score >= 85 ? "這一回，穩。" : result.score >= 60 ? "這一回，有底。" : "這一回，先記住。";
  dom.resultSubtitle.textContent = result.score >= 85 ? "手感已經成形，繼續保持這個節奏。" : "把錯的留下來，下一回會更快。";
  renderResultUnits();
  renderReview();
}

function renderReview() {
  const result = state.lastResult;
  if (!result) return;
  let items = result.results;
  if (state.reviewFilter === "wrong") items = items.filter((item) => !item.correct && item.answer);
  if (state.reviewFilter === "unanswered") items = items.filter((item) => !item.answer);
  dom.reviewCountLabel.textContent = `${items.length} 題`;
  if (!items.length) {
    dom.reviewList.innerHTML = `<div class="empty-state">這個篩選沒有題目，做得漂亮。</div>`;
    return;
  }
  dom.reviewList.innerHTML = items.map(({ question, answer, correct }) => {
    const status = !answer ? "unanswered" : correct ? "correct" : "wrong";
    const statusLabel = status === "correct" ? "答對" : status === "wrong" ? "再看" : "未答";
    return `<article class="review-item is-${status}"><div class="review-item-top"><span class="review-item-number">${question.year} · 第 ${question.questionNumber} 題</span><span class="review-status status-${status}">${statusLabel}</span></div><p class="review-question">${escapeHtml(question.questionText)}</p><div class="review-answers">你的答案：<strong>${answer || "未作答"}</strong> · 正確答案：<strong>${formatAccepted(question)}</strong></div>${question.answerNote ? `<div class="review-answer-note">${escapeHtml(question.answerNote)}</div>` : ""}${question.pageImage ? `<button class="source-button review-source-button" type="button" data-source-id="${question.id}">查看原卷第 ${question.sourcePage} 頁 ↗</button>` : ""}</article>`;
  }).join("");
  $$("[data-source-id]").forEach((button) => button.addEventListener("click", () => openSourceById(button.dataset.sourceId)));
}

function renderResultUnits() {
  const groups = new Map();
  state.lastResult.results.forEach(({ question, correct }) => {
    if (!groups.has(question.unit)) groups.set(question.unit, { correct: 0, total: 0 });
    const group = groups.get(question.unit);
    group.total += 1;
    if (correct) group.correct += 1;
  });
  const rows = [...groups.entries()].sort((a, b) => naturalCompare(a[0], b[0]));
  dom.resultUnits.innerHTML = rows.map(([unit, value]) => {
    const percentage = Math.round((value.correct / value.total) * 100);
    return `<div class="unit-row"><div class="unit-row-label"><strong>${escapeHtml(unit)}</strong><span>${value.correct}/${value.total} · ${percentage}%</span></div><div class="unit-track"><span style="width:${percentage}%"></span></div></div>`;
  }).join("");
}

function renderHome() {
  const questions = state.questions;
  const history = allHistory();
  const wrong = wrongMap();
  const averages = Object.fromEntries(Object.entries(historyMap()).map(([mode, records]) => [mode, records.length ? Math.round(records.reduce((sum, record) => sum + record.score, 0) / records.length) : null]));
  const average = history.length ? Math.round(history.reduce((sum, record) => sum + record.score, 0) / history.length) : null;
  dom.heroCount.textContent = questions.length.toLocaleString("zh-TW");
  dom.statCompleted.textContent = history.length;
  dom.statAverage.textContent = average === null ? "—" : `${average}%`;
  dom.statWrong.textContent = Object.keys(wrong).length;
  dom.statAverage.title = Object.entries(averages).map(([mode, value]) => `${MODES[mode]?.label || mode}：${value === null ? "—" : `${value}%`}`).join("｜") || "完成測驗後顯示各模式平均正確率";
  const counts = questions.reduce((result, question) => {
    result[question.subjectCode] = (result[question.subjectCode] || 0) + 1;
    return result;
  }, {});
  dom.legalCount.textContent = `${counts.legal || 0} 題`;
  dom.structureCount.textContent = `${counts.structure || 0} 題`;
  renderRecentHistory(history);
  renderWeakUnits(wrong);
  updateModeAvailability();
}

function renderRecentHistory(history) {
  if (!history.length) {
    dom.recentHistory.innerHTML = `<div class="empty-state">完成一次練習後，結果會出現在這裡。</div>`;
    return;
  }
  dom.recentHistory.innerHTML = history.slice(0, 4).map((record) => `<div class="history-row"><span class="history-type">${escapeHtml(MODES[record.mode]?.short || "測驗")}</span><div class="history-info"><strong>${escapeHtml(record.filterLabel || "全部科目")}</strong><span>${new Date(record.completedAt).toLocaleDateString("zh-TW")} · ${record.correct}/${record.total} 題</span></div><span class="history-score">${record.score}%</span></div>`).join("");
}

function renderWeakUnits(wrong) {
  const grouped = {};
  Object.values(wrong).forEach((item) => {
    grouped[item.unit] = (grouped[item.unit] || 0) + (item.count || 1);
  });
  const rows = Object.entries(grouped).sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0])).slice(0, 4);
  if (!rows.length) {
    dom.weakUnits.innerHTML = `<div class="empty-state">錯題會依單元累計，幫你找到下個落點。</div>`;
    return;
  }
  const max = rows[0][1];
  dom.weakUnits.innerHTML = rows.map(([unit, count]) => `<div class="weak-row"><div class="weak-row-top"><span>${escapeHtml(unit)}</span><span>${count} 次</span></div><div class="weak-bar"><span style="width:${Math.max(15, (count / max) * 100)}%"></span></div></div>`).join("");
}

function openSourceById(id) {
  const question = state.questions.find((item) => item.id === id);
  if (!question?.pageImage) {
    showToast("這題沒有可顯示的原卷頁面。");
    return;
  }
  dom.sourceDialogTitle.textContent = `${question.subject} · ${question.year} 年 · 第 ${question.questionNumber} 題`;
  dom.sourceDialogImage.src = question.pageImage;
  dom.sourceDialogImage.alt = `${question.subject} ${question.year} 年原卷第 ${question.sourcePage} 頁`;
  if (typeof dom.sourceDialog.showModal === "function") dom.sourceDialog.showModal();
  else dom.sourceDialog.setAttribute("open", "");
}

function bindEvents() {
  dom.subject.addEventListener("change", () => {
    state.subject = dom.subject.value;
    state.year = "all";
    refreshYears();
    renderHome();
  });
  dom.year.addEventListener("change", () => {
    state.year = dom.year.value;
    renderHome();
  });
  dom.modeList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button && !button.disabled) setMode(button.dataset.mode);
  });
  dom.setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startQuiz(state.mode);
  });
  dom.previousButton.addEventListener("click", () => {
    if (state.currentIndex > 0) {
      state.currentIndex -= 1;
      renderQuestion();
    }
  });
  dom.nextButton.addEventListener("click", () => {
    if (state.currentIndex === state.activeQuestions.length - 1) submitQuiz();
    else {
      state.currentIndex += 1;
      renderQuestion();
    }
  });
  dom.flagButton.addEventListener("click", toggleFlag);
  dom.sourceButton.addEventListener("click", () => openSourceById(state.activeQuestions[state.currentIndex]?.id));
  $("#quitQuizButton").addEventListener("click", attemptQuit);
  $("#brandHome").addEventListener("click", (event) => { event.preventDefault(); if (!dom.quiz.hidden) attemptQuit(); else { showView("home"); renderHome(); } });
  [$("#resultHomeButton"), $("#resultHomeButton2")].forEach((button) => button.addEventListener("click", () => { showView("home"); renderHome(); }));
  $("#retryButton").addEventListener("click", () => startQuiz(state.lastResult?.mode || "quick"));
  $("#helpButton").addEventListener("click", () => dom.helpDialog.showModal());
  $("#closeHelpButton").addEventListener("click", () => dom.helpDialog.close());
  $("#closeSourceButton").addEventListener("click", () => dom.sourceDialog.close());
  [dom.helpDialog, dom.sourceDialog].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
  $$("[data-review-filter]").forEach((button) => button.addEventListener("click", () => {
    state.reviewFilter = button.dataset.reviewFilter;
    $$("[data-review-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderReview();
  }));
}

async function init() {
  bindEvents();
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    state.questions = Array.isArray(state.data.questions) ? state.data.questions : [];
    renderFilters();
    renderHome();
  } catch (error) {
    console.error(error);
    dom.heroCount.textContent = "—";
    dom.selectionSummary.textContent = "無法載入題庫，請使用本機伺服器開啟 docs/。";
    dom.startButton.disabled = true;
    showToast("題庫載入失敗，請用 README 的本機預覽指令開啟。");
  }
}

init();
