#!/usr/bin/env python3
"""Extract the architect exam PDFs into the JSON contract used by the quiz site.

The source bundle is intentionally kept outside docs/.  This script is safe to
rerun after replacing the extracted PDFs in tmp/pdfs/.
"""

from __future__ import annotations

import argparse
import bisect
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

import pdfplumber


SUBJECTS = [
    {
        "code": "legal",
        "name": "營建法規與實務",
        "root": "legal",
        "folder": "法規",
        "exam_code": "0101",
        "source_glob": "*_0101_*.pdf",
    },
    {
        "code": "structure",
        "name": "建築構造與施工",
        "root": "structure",
        "folder": "構造",
        "exam_code": "0103",
        "source_glob": "*_0103_*.pdf",
    },
]

LEGAL_CATEGORY_RULES = [
    {
        "code": "accessible-facilities-design",
        "name": "無障礙設施設計規範",
        "terms": (
            "建築物無障礙設施設計規範",
            "無障礙設施設計規範",
        ),
        "fallback_terms": (
            "無障礙",
            "行動不便者使用設施",
        ),
    },
    {
        "code": "building-technical-regulations",
        "name": "建築技術規則",
        "terms": (
            "建築技術規則",
            "建築設計施工編",
            "建築構造編",
            "建築設備編",
            "建築技術規則總則編",
        ),
    },
    {
        "code": "architect-act",
        "name": "建築師法",
        "terms": ("建築師法",),
    },
    {
        "code": "construction-industry-act",
        "name": "營造業法",
        "terms": ("營造業法",),
    },
    {
        "code": "apartment-building-management",
        "name": "公寓大廈管理",
        "terms": ("公寓大廈管理條例",),
    },
    {
        "code": "government-procurement",
        "name": "政府採購與工程管理",
        "terms": (
            "政府採購法",
            "政府採購",
            "最有利標評選辦法",
            "機關委託技術服務廠商評選及計費辦法",
            "公共工程施工品質管理作業要點",
        ),
    },
    {
        "code": "urban-renewal",
        "name": "都市更新與危老重建",
        "terms": (
            "都市更新條例",
            "都市更新權利變換實施辦法",
            "都市更新建築容積獎勵辦法",
            "都市危險及老舊建築物加速重建條例",
            "都市危險及老舊建築物建築容積獎勵辦法",
        ),
    },
    {
        "code": "planning-and-land-use",
        "name": "都市計畫與國土使用",
        "terms": (
            "都市計畫法",
            "國土計畫法",
            "區域計畫法",
            "非都市土地使用管制規則",
            "實施區域計畫地區建築管理辦法",
            "都市計畫容積移轉實施辦法",
            "國家公園法",
            "山坡地保育利用條例",
            "農業用地興建農舍辦法",
            "農業發展條例",
        ),
    },
    {
        "code": "interior-and-public-safety",
        "name": "室內裝修與公共安全",
        "terms": (
            "建築物室內裝修管理辦法",
            "建築物公共安全檢查簽證及申報辦法",
            "原有合法建築物公共安全改善辦法",
            "原有合法建築物防火避難設施及消防設備改善辦法",
            "建築物使用類組及變更使用辦法",
            "消防法",
        ),
    },
    {
        "code": "building-act-and-management",
        "name": "建築法與建築管理",
        "terms": (
            "建築法",
            "違章建築處理辦法",
            "建築基地法定空地分割辦法",
            "山坡地建築管理辦法",
            "建築物部分使用執照核發辦法",
            "招牌廣告及樹立廣告管理辦法",
            "建造執照預審辦法",
        ),
    },
]

OTHER_LEGAL_CATEGORY = {
    "code": "other-related-regulations",
    "name": "其他相關法規",
}

OPTION_GLYPHS = {
    chr(0xE18C): "A",
    chr(0xE18D): "B",
    chr(0xE18E): "C",
    chr(0xE18F): "D",
}
OPTION_MARKER_RE = re.compile(
    r"(?:[" + "".join(re.escape(g) for g in OPTION_GLYPHS) + r"]|\([A-D]\)|（[Ａ-Ｄ]）)"
)
QUESTION_START_RE = re.compile(r"(?m)^[ \t]*([0-9]{1,3})[ \t]+")
ANSWER_TOKEN_RE = re.compile(r"[A-D#]+")
ANSWER_LETTER_RE = re.compile(r"[ABCD]")


@dataclass
class QuestionStart:
    number: int
    offset: int


def normalize_text(text: str) -> str:
    """Apply only safe Unicode/whitespace cleanup; do not rewrite wording."""

    # NFC keeps the original full-width punctuation and typography in the
    # question bank. Compatibility normalization is used only while parsing
    # answer-letter tokens below.
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\u00a0", " ").replace("\u200b", "")
    text = text.replace("\r", "")
    return re.sub(r"[ \t\n\f\v]+", " ", text).strip()


def classify_legal_category(question_text: str) -> tuple[str, str]:
    """Assign one primary category from explicit law names and safe topic fallbacks."""

    compact_text = re.sub(r"\s+", "", question_text)
    for category in LEGAL_CATEGORY_RULES:
        if any(term in compact_text for term in category["terms"]):
            return category["code"], category["name"]
    for category in LEGAL_CATEGORY_RULES:
        if any(term in compact_text for term in category.get("fallback_terms", ())):
            return category["code"], category["name"]
    return OTHER_LEGAL_CATEGORY["code"], OTHER_LEGAL_CATEGORY["name"]


def extract_pdf_pages(path: Path) -> list[str]:
    with pdfplumber.open(path) as pdf:
        return [(page.extract_text() or "") for page in pdf.pages]


def join_pages(pages: list[str]) -> tuple[str, list[int]]:
    chunks: list[str] = []
    starts: list[int] = []
    offset = 0
    for page in pages:
        starts.append(offset)
        chunks.append(page)
        offset += len(page) + 1
    return "\n".join(chunks), starts


def question_starts(text: str) -> list[QuestionStart]:
    candidates = [
        QuestionStart(int(match.group(1)), match.start())
        for match in QUESTION_START_RE.finditer(text)
        if 1 <= int(match.group(1)) <= 80
    ]

    # A few first pages start with a year (104/105/etc.), which is intentionally
    # outside this range. Select the clean 1..80 sequence instead of silently
    # trusting every numeric line in OCR/PDF text.
    for index, candidate in enumerate(candidates):
        if candidate.number != 1:
            continue
        selected = [candidate]
        expected = 2
        for following in candidates[index + 1 :]:
            if following.number == expected:
                selected.append(following)
                expected += 1
                if expected == 81:
                    return selected
        if len(selected) >= 20:
            return selected
    return []


def strip_pdf_noise(text: str) -> str:
    lines = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if re.match(r"^(?:代號|頁次)\s*[:：]", line):
            continue
        if re.match(r"^[0-9]{2,3}\s*年.*(?:考試|試題)", line):
            continue
        if line.startswith("技師、第二次食品技師") or line.startswith("食品技師考試暨普通"):
            continue
        if line.startswith("考試名稱") or line.startswith("等別") or line.startswith("類科"):
            continue
        if line.startswith("科目") or line.startswith("考試時間") or line.startswith("座號"):
            continue
        if line.startswith("※注意") or line.startswith("(一)") or line.startswith("(二)") or line.startswith("(三)"):
            continue
        lines.append(line)
    return "\n".join(lines)


def parse_options(segment: str) -> tuple[str, list[dict[str, str]]]:
    cleaned = strip_pdf_noise(segment)
    matches = list(OPTION_MARKER_RE.finditer(cleaned))
    if not matches:
        stem = normalize_text(cleaned)
        return stem, [
            {"key": key, "text": "原卷圖示（請查看原卷頁面）"} for key in "ABCD"
        ]

    stem = normalize_text(cleaned[: matches[0].start()])
    option_map: dict[str, str] = {}
    for index, match in enumerate(matches):
        marker = match.group(0)
        key = (
            OPTION_GLYPHS[marker]
            if marker in OPTION_GLYPHS
            else unicodedata.normalize("NFKC", marker)[-2]
        )
        end = matches[index + 1].start() if index + 1 < len(matches) else len(cleaned)
        option_text = normalize_text(cleaned[match.end() : end])
        if key not in option_map:
            option_map[key] = option_text
    options = [
        {
            "key": key,
            "text": option_map.get(key) or "原卷圖示（請查看原卷頁面）",
        }
        for key in "ABCD"
    ]
    return stem, options


def page_number_for_offset(offset: int, page_offsets: list[int]) -> int:
    return max(1, bisect.bisect_right(page_offsets, offset))


def parse_question_pdf(path: Path) -> tuple[list[dict], list[str]]:
    pages = extract_pdf_pages(path)
    text, page_offsets = join_pages(pages)
    starts = question_starts(text)
    questions: list[dict] = []
    issues: list[str] = []
    if len(starts) != 80:
        issues.append(f"{path.name}: detected {len(starts)} question starts, expected 80")

    for index, start in enumerate(starts):
        end = starts[index + 1].offset if index + 1 < len(starts) else len(text)
        stem, options = parse_options(text[start.offset + len(str(start.number)) : end])
        if len(options) != 4 or [option["key"] for option in options] != list("ABCD"):
            issues.append(
                f"{path.name} q{start.number}: expected A-D options, got {[option['key'] for option in options]}"
            )
            continue
        if not stem:
            issues.append(f"{path.name} q{start.number}: empty question stem")
            continue
        questions.append(
            {
                "questionNumber": start.number,
                "questionText": stem,
                "options": options,
                "sourcePage": page_number_for_offset(start.offset, page_offsets),
            }
        )
    return questions, issues


def extract_answer_info(path: Path) -> tuple[list[str | None], dict[int, dict]]:
    pages = extract_pdf_pages(path)
    text = normalize_text("\n".join(pages))
    note_map: dict[int, dict] = {}
    note_markers = list(re.finditer(r"備\s*註", text))
    if note_markers:
        # The correction form mentions 備註 in its introductory sentence too;
        # the final occurrence is the actual note block at the bottom.
        note_text = text[note_markers[-1].end() :]
        for match in re.finditer(
            r"第\s*([0-9]{1,3})\s*題(.*?)(?=第\s*[0-9]{1,3}\s*題|$)",
            note_text,
        ):
            number = int(match.group(1))
            note = match.group(0).strip()
            note_compact = unicodedata.normalize("NFKC", re.sub(r"\s+", "", note))
            if "一律給分" in note_compact:
                note_map[number] = {
                    "acceptedAnswers": list("ABCD"),
                    "answerNote": "本題一律給分",
                }
            else:
                letters = []
                for letter in ANSWER_LETTER_RE.findall(note_compact.upper()):
                    if letter not in letters:
                        letters.append(letter)
                if letters:
                    note_map[number] = {
                        "acceptedAnswers": letters,
                        "answerNote": note,
                    }

    answer_tokens: list[str] = []
    for line in "\n".join(pages).splitlines():
        if not line.strip().startswith("答案"):
            continue
        tail = line.split("答案", 1)[1].upper()
        answer_tokens.extend(ANSWER_TOKEN_RE.findall(unicodedata.normalize("NFKC", tail)))

    answers: list[str | None] = []
    for token in answer_tokens:
        token = token.upper()
        if token == "#":
            answers.append(None)
        elif set(token) <= set("ABCD") and 1 <= len(token) <= 4:
            answers.append(token[0])
    return answers[:80], note_map


def find_answer_file(source_path: Path, answer_dir: Path, marker: str) -> Path | None:
    prefix = source_path.name.split("_", 1)[0]
    candidates = sorted(answer_dir.glob(f"{prefix}_{marker}*.pdf"))
    return candidates[0] if candidates else None


def resolve_poppler(binary: str | None) -> str | None:
    if binary:
        return binary
    return shutil.which("pdftoppm")


def render_pages(pdf_path: Path, output_dir: Path, prefix: str, pdftoppm: str) -> tuple[int, str | None]:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_prefix = output_dir / prefix
    existing = list(output_dir.glob(f"{prefix}-*.jpg"))
    if existing:
        return len(existing), None
    command = [
        pdftoppm,
        "-jpeg",
        "-r",
        "110",
        "-jpegopt",
        "quality=78,optimize=y,progressive=y",
        str(pdf_path),
        str(output_prefix),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as exc:
        return 0, str(exc)
    if result.returncode != 0:
        return 0, (result.stderr or result.stdout or "pdftoppm failed").strip()
    count = len(list(output_dir.glob(f"{prefix}-*.jpg")))
    return count, None


def subject_records(input_root: Path, subject: dict) -> Iterable[tuple[dict, Path, Path, Path | None]]:
    source_dir = input_root / subject["root"] / subject["folder"]
    answer_dir = source_dir / "解答"
    correction_dir = answer_dir / "解答修正"
    for source_path in sorted(source_dir.glob(subject["source_glob"])):
        if "解答" in source_path.parts:
            continue
        standard = find_answer_file(source_path, answer_dir, "ANS")
        correction = find_answer_file(source_path, correction_dir, "MOD")
        year_match = re.match(r"([0-9]{3})", source_path.name)
        if not year_match:
            continue
        yield subject, source_path, standard, correction


def build_dataset(input_root: Path, output_path: Path, assets_root: Path, pdftoppm: str | None) -> dict:
    all_questions: list[dict] = []
    skipped: list[str] = []
    ignored: list[str] = []
    answer_issues: list[str] = []
    rendered: list[str] = []
    source_files: list[str] = []
    source_order = 0
    renderer = resolve_poppler(pdftoppm)

    for subject in SUBJECTS:
        for subject_info, source_path, standard_path, correction_path in subject_records(input_root, subject):
            source_files.append(str(source_path.relative_to(input_root)).replace("\\", "/"))
            year = int(source_path.name[:3])
            parsed, issues = parse_question_pdf(source_path)
            skipped.extend(issues)
            if not parsed:
                continue

            answer_path = correction_path or standard_path
            if answer_path is None:
                answer_issues.append(f"{source_path.name}: answer PDF not found")
                continue
            answers, notes = extract_answer_info(answer_path)
            if len(answers) != 80:
                answer_issues.append(f"{answer_path.name}: detected {len(answers)} answers, expected 80")
                continue

            page_count = max((question["sourcePage"] for question in parsed), default=0)
            prefix = source_path.name.split("_", 1)[0]
            page_dir = assets_root / subject["code"]
            rendered_count = 0
            if renderer:
                rendered_count, render_issue = render_pages(source_path, page_dir, prefix, renderer)
                if render_issue:
                    ignored.append(f"{source_path.name}: page rendering skipped ({render_issue})")
                else:
                    rendered.append(f"{source_path.name}: {rendered_count} pages")
            else:
                ignored.append("pdftoppm not found; source page images were not generated")

            if len(parsed) != len(answers):
                answer_issues.append(f"{source_path.name}: {len(parsed)} questions vs {len(answers)} answers")
                continue

            for item in parsed:
                question_number = item["questionNumber"]
                raw_answer = answers[question_number - 1]
                if raw_answer is None:
                    note = notes.get(question_number)
                    if not note:
                        answer_issues.append(f"{source_path.name} q{question_number}: correction marker has no note")
                        continue
                    accepted = note["acceptedAnswers"]
                    answer_note = note["answerNote"]
                else:
                    note = notes.get(question_number)
                    accepted = note["acceptedAnswers"] if note else [raw_answer]
                    answer_note = note["answerNote"] if note else None

                if not accepted or any(answer not in "ABCD" for answer in accepted):
                    answer_issues.append(f"{source_path.name} q{question_number}: invalid answer set {accepted}")
                    continue
                source_order += 1
                page = item["sourcePage"]
                page_image = None
                if rendered_count:
                    possible_assets = [
                        page_dir / f"{prefix}-{page}.jpg",
                        page_dir / f"{prefix}-{page:02d}.jpg",
                    ]
                    asset = next((candidate for candidate in possible_assets if candidate.exists()), None)
                    if asset:
                        page_image = asset.relative_to(output_path.parent.parent).as_posix()
                legal_category_code = None
                legal_category = None
                if subject["code"] == "legal":
                    legal_category_code, legal_category = classify_legal_category(item["questionText"])
                all_questions.append(
                    {
                        "id": f"{subject['code']}-{year}-{question_number:03d}",
                        "sourceOrder": source_order,
                        "subject": subject["name"],
                        "subjectCode": subject["code"],
                        "year": year,
                        "unit": f"{subject['name']}｜{year} 年",
                        "legalCategoryCode": legal_category_code,
                        "legalCategory": legal_category,
                        "questionNumber": question_number,
                        "questionText": item["questionText"],
                        "options": item["options"],
                        "answer": accepted[0],
                        "acceptedAnswers": accepted,
                        "answerNote": answer_note,
                        "sourceFile": source_path.name,
                        "sourcePage": page,
                        "pageImage": page_image,
                    }
                )

    units = sorted({question["unit"] for question in all_questions})
    subjects = sorted({question["subject"] for question in all_questions})
    years = sorted({question["year"] for question in all_questions})
    legal_category_counts: dict[str, int] = {}
    for question in all_questions:
        category_code = question["legalCategoryCode"]
        if category_code:
            legal_category_counts[category_code] = legal_category_counts.get(category_code, 0) + 1
    legal_categories = [
        {
            "code": category["code"],
            "name": category["name"],
            "questionCount": legal_category_counts.get(category["code"], 0),
        }
        for category in [*LEGAL_CATEGORY_RULES, OTHER_LEGAL_CATEGORY]
    ]
    dataset = {
        "metadata": {
            "sourceName": "建築師國考歷屆試題（法規、構造）",
            "generatedAt": date.today().isoformat(),
            "questionCount": len(all_questions),
            "unitCount": len(units),
            "subjects": subjects,
            "years": years,
            "legalCategories": legal_categories,
            "legalCategoryPolicy": "依題幹明示的法規名稱歸類；無障礙設施設計另以高辨識度專有用語補充分類，無法判定者列為其他相關法規。",
            "answerPolicy": "答案修正檔優先；撤銷題依備註採多重給分。",
        },
        "cleaningReport": {
            "sourceFiles": source_files,
            "renderedPageSets": rendered,
            "ignored": sorted(set(ignored)),
            "skipped": skipped,
            "answerIssues": answer_issues,
        },
        "questions": all_questions,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    return dataset


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, default=Path("tmp/pdfs"))
    parser.add_argument("--output", type=Path, default=Path("docs/data/questions.json"))
    parser.add_argument("--assets-root", type=Path, default=Path("docs/assets/pages"))
    parser.add_argument("--pdftoppm", default=None)
    args = parser.parse_args()

    try:
        dataset = build_dataset(args.input_root, args.output, args.assets_root, args.pdftoppm)
    except Exception as exc:  # Keep a useful CLI failure for malformed source data.
        print(f"build failed: {exc}", file=sys.stderr)
        return 1
    report = dataset["cleaningReport"]
    print(
        json.dumps(
            {
                "questions": dataset["metadata"]["questionCount"],
                "units": dataset["metadata"]["unitCount"],
                "sourceFiles": len(report["sourceFiles"]),
                "skipped": len(report["skipped"]),
                "answerIssues": len(report["answerIssues"]),
                "ignored": len(report["ignored"]),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
