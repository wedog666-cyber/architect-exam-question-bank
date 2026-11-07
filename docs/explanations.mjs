// Hand-authored explanations: a separate file survives rebuilding the PDF bank.
const SOURCE = "https://www.freeway.gov.tw/Upload/201604/建築物無障礙設施設計規範.pdf";
const NOTES = [
  ["legal-105-072", "D", "204.2.3", "走廊迴轉空間須達 150 × 150 公分；A、B、C 的兩邊都不足。注意題目問的是迴轉空間，不是通行寬度。"],
  ["legal-105-073", "C", "205.2.2", "平台寬、深的下限都是 150 公分，坡度上限為 1/50，因此 X、Y、Z 分別為 150、150、50。其他選項未同時符合三個條件。"],
  ["legal-105-075", "B", "207.2.2", "圓形扶手直徑範圍約 2.8～4 公分。只有 3.5 在範圍內；2.5 太小，4.5 與 5.5 太大。"],
  ["legal-105-079", "A", "805.1、805.2", "出入口與車道都須至少 180 公分。B 的 150 不足；C 的寬度須改為至少 225；D 的標誌須至少 90 × 90 公分。"],
  ["legal-105-080", "B", "1003.1", "題目要找錯誤敘述。無障礙客房內須有衛浴設備，因此 B 所說可以免設是錯的，應選 B。"],
  ["legal-106-027", "B", "506.5", "題目要找錯誤敘述。小便器淨空間須從中心線向左右各留至少 50 公分；B 寫各 40，少了 10 公分。"],
  ["legal-106-036", "D", "206.5.2", "雙道扶手高度是上 85、下 65 公分，所以選 D。75 公分是單道扶手高度，不適用本題的雙道條件。"],
  ["legal-106-075", "B", "203.2.5", "主要行進方向的開口上限為 1.3 公分。0.8 雖較小，但不是題目問的最大允許值；2.0 與 2.5 超過上限。"],
  ["legal-106-077", "B", "303.4", "防護緣最低為 5 公分。3 不足；8、10 雖較高，卻不是題目問的最低門檻。"],
  ["legal-107-003", "C", "205.2.3", "一般門框淨距至少 90 公分；折疊門扣除門扇後至少 80 公分。題目分別問這兩種條件，故 X=90、Y=80。"],
  ["legal-107-077", "B", "207.3.3", "一般雙層扶手為 65、85 公分；小學各降低 10 公分，得到 55、75。選 65、85 是漏看了小學這個條件。"],
];

export const explanations = Object.fromEntries(NOTES.map(([id, answer, section, text]) => [id, {
  answer, section, text, source: SOURCE,
  sourceLabel: "建築物無障礙設施設計規範（101 年修正版；高公局存檔）",
}]));

const escape = (text) => String(text ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function renderExplanation(question, answer, correct) {
  const accepted = question.acceptedAnswers;
  const allAccepted = accepted.length === 4;
  const note = explanations[question.id];
  // Never attach an explanation to a changed/revoked answer key.
  const verified = note && accepted.length === 1 && accepted[0] === note.answer;
  const negative = /(?:何者|何項|哪些|何種|何一).*?(?:錯誤|不正確|不符|不適當|不包括|不包含)/.test(question.questionText.replace(/\s/g, ""));
  let guidance;
  if (allAccepted) guidance = "本題依答案修正採各選項給分，不能把某一個選項當成唯一正確結論。請留意上方修正備註。";
  else if (accepted.length > 1) guidance = `本題接受 ${accepted.join("、")}，選其中任一答案即可得分；請留意答案修正備註。`;
  else if (negative) guidance = "這題問的是錯誤或不符合條件的選項。下方標示的標準答案是本題應選的選項，不代表那句話本身正確。";
  else guidance = "請把題幹的條件、數值單位與標準答案逐一對照。下方保留所有選項，方便比較你選的內容。";
  const options = question.options.map(option => {
    const chosen = option.key === answer;
    const expected = accepted.includes(option.key);
    const labels = [chosen ? "你的選擇" : "", expected ? (allAccepted ? "給分選項" : "標準答案") : ""].filter(Boolean);
    return `<li class="review-option${expected ? " is-expected" : chosen ? " is-chosen-wrong" : ""}"><strong>${escape(option.key)}${labels.length ? ` · ${labels.join("／")}` : ""}</strong><span>${escape(option.text)}</span></li>`;
  }).join("");
  const detail = verified
    ? `<h3>判斷理由</h3><p>${escape(note.text)}</p><p class="explanation-source">依據：第 ${escape(note.section)} 節 · <a href="${escape(note.source)}" target="_blank" rel="noopener noreferrer">${escape(note.sourceLabel)}</a></p><p class="explanation-note">此解析對應本題考試年度；歷屆試題與現行規定可能不同。</p>`
    : allAccepted ? "" : `<p class="explanation-pending">詳細解析待補：目前提供答案對照，尚未完成本題的${question.subjectCode === "legal" ? "法條" : "原理或計算"}理由核對。</p>`;
  return `<details class="review-explanation"${correct ? "" : " open"}><summary>${verified ? "答案解析" : "答案對照與判讀提示"}</summary><p>${!answer ? "本題未作答。" : ""}${escape(guidance)}</p><ul class="review-option-list">${options}</ul>${detail}</details>`;
}
