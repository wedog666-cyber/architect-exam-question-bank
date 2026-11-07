import fs from 'node:fs';
import path from 'node:path';

// Batch files are editorial source; questions and official scoring remain unchanged.
const questions = JSON.parse(fs.readFileSync('docs/data/questions.json', 'utf8')).questions;
const byId = new Map(questions.map(q => [q.id, q]));
const folder = 'scripts/explanation-batches';
const notes = {};
for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.json')).sort()) {
  const batch = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  for (const [id, note] of Object.entries(batch)) {
    const q = byId.get(id);
    if (!q || notes[id]) throw new Error(`Unknown or duplicate question: ${id}`);
    if (!Array.isArray(note.acceptedAnswers) || JSON.stringify(note.acceptedAnswers) !== JSON.stringify(q.acceptedAnswers)) throw new Error(`Answer mismatch: ${id}`);
    if (typeof note.text !== 'string' || note.text.trim().length < 25) throw new Error(`Explanation too short: ${id}`);
    if (!Array.isArray(note.sources)) throw new Error(`Missing sources array: ${id}`);
    for (const source of note.sources) {
      if (!source.title || !/^https:\/\//.test(source.url)) throw new Error(`Invalid source: ${id}`);
    }
    if (!['checked', 'historical', 'principle', 'uncertain'].includes(note.status)) throw new Error(`Invalid status: ${id}`);
    if (typeof note.currentNote !== 'string') throw new Error(`Missing current note: ${id}`);
    notes[id] = note;
  }
}
const missing = questions.filter(q => !notes[q.id]).map(q => q.id);
const statuses = Object.values(notes).reduce((acc, n) => { acc[n.status] = (acc[n.status] || 0) + 1; return acc; }, {});
console.log(JSON.stringify({ total: questions.length, explained: Object.keys(notes).length, statuses, missing }, null, 2));
if (missing.length) process.exitCode = 1;
else fs.writeFileSync('docs/data/explanations.json', JSON.stringify({ metadata: { updatedAt: '2026-11-07', questionCount: questions.length, statuses }, explanations: notes }, null, 2) + '\n');
