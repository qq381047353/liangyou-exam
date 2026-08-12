# -*- coding: utf-8 -*-
"""解析《粮油保管员练习题（带解析）》Markdown -> 结构化 JSON。

题型：单选（639）、判断（161）。
格式：
  ### 第N题 ［单选］
  题干...
  - A. xxx
  - B. xxx
  **答案：X**
  **解析：** ...
  ### 第N题 ［判断］
  题干...
  - （判断题：正确请选 √，错误请选 ×）
  **答案：√**
  **解析：** ...
"""
import re
import json
import os

SRC = r"C:\Users\win11\WorkBuddy\2026-08-10-17-08-51\粮油保管员练习题_带解析.md"
OUT = r"C:\Users\win11\WorkBuddy\2026-08-12-16-16-21\questions.json"

HEADER_RE = re.compile(r"^###\s*第(\d+)题\s*［(单选|判断)］\s*$")
ANSWER_RE = re.compile(r"^\*\*答案[:：]\s*(.+?)\s*\*\*\s*$")
OPTION_RE = re.compile(r"^-?\s*([A-Z])\.\s*(.*)$")
ANALYSIS_RE = re.compile(r"^\*\*解析[:：\]\s]?\**\s*(.*)$")
JUDGE_HINT_RE = re.compile(r"判断题[:：]")


def parse(md_path):
    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.read().split("\n")

    questions = []
    cur = None
    state = None  # 'question' | 'options' | 'analysis'

    def flush():
        nonlocal cur
        if cur is not None:
            # 收尾：清理题干里的判断提示语
            if cur["type"] == "判断":
                qlines = []
                for ln in cur["question"].split("\n"):
                    if "判断题" in ln or "正确请选" in ln or "错误请选" in ln:
                        continue
                    qlines.append(re.sub(r"^-\s*", "", ln).strip())
                cur["question"] = "\n".join(l for l in qlines if l).strip()
                cur["options"] = ["√", "×"]
            cur["question"] = cur["question"].strip()
            questions.append(cur)
        cur = None

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        m = HEADER_RE.match(line.strip())
        if m:
            flush()
            cur = {
                "id": int(m.group(1)),
                "type": m.group(2),
                "question": "",
                "options": [],
                "answer": "",
                "analysis": "",
            }
            state = "question"
            i += 1
            continue

        if cur is None:
            i += 1
            continue

        am = ANSWER_RE.match(line.strip())
        if am:
            cur["answer"] = am.group(1).strip()
            state = "analysis_wait"  # 下一行应是解析
            i += 1
            continue

        # 解析行
        anm = ANALYSIS_RE.match(line.strip())
        if state in ("analysis_wait", "analysis") and (anm or state == "analysis"):
            if anm:
                cur["analysis"] = anm.group(1)
            else:
                # 解析续行
                cur["analysis"] = (cur["analysis"] + "\n" + line.strip()).strip()
            state = "analysis"
            i += 1
            continue

        # 选项行（单选）
        om = OPTION_RE.match(line.strip())
        if cur["type"] == "单选" and om and state in ("question", "options"):
            if state == "question":
                # 之前累积的题干可能是误收，保留题干文本（不，题干已单独收集）
                pass
            cur["options"].append({"key": om.group(1), "text": om.group(2).strip()})
            state = "options"
            i += 1
            continue

        # 判断提示行或普通 "- " 行
        if line.strip().startswith("-"):
            if state == "question":
                # 题干可能跨行，先不要急；判断提示归入题干后会被清理
                cur["question"] = (cur["question"] + "\n" + line.strip()).strip()
            state = state if state != "question" else "options"
            i += 1
            continue

        # 普通文本行
        if line.strip():
            cur["question"] = (cur["question"] + "\n" + line.strip()).strip()
        i += 1

    flush()

    # 排序、补缺失
    questions.sort(key=lambda q: q["id"])
    return questions


def main():
    qs = parse(SRC)
    single = [q for q in qs if q["type"] == "单选"]
    judge = [q for q in qs if q["type"] == "判断"]
    print(f"总题数: {len(qs)}")
    print(f"单选: {len(single)}  判断: {len(judge)}")

    # 校验
    bad = []
    for q in qs:
        if q["type"] == "单选":
            keys = [o["key"] for o in q["options"]]
            if q["answer"] not in keys:
                bad.append((q["id"], "答案不在选项中", q["answer"], keys))
            if len(q["options"]) < 2:
                bad.append((q["id"], "选项过少", len(q["options"])))
        else:
            if q["answer"] not in ("√", "×"):
                bad.append((q["id"], "判断答案非法", q["answer"]))
        if not q["question"]:
            bad.append((q["id"], "题干为空", ""))
    if bad:
        print("⚠ 校验问题:")
        for b in bad[:30]:
            print("  ", b)
        print(f"  共 {len(bad)} 处")
    else:
        print("✓ 校验通过（答案均在选项内、题干非空）")

    # 检查 id 连续性
    ids = [q["id"] for q in qs]
    missing = [i for i in range(1, len(qs) + 1) if i not in ids]
    if missing:
        print("⚠ 缺失题号:", missing[:20])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(qs, f, ensure_ascii=False, indent=1)
    print(f"已写出: {OUT}")


if __name__ == "__main__":
    main()
