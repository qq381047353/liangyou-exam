import re, json
from collections import Counter, OrderedDict

BASE = r"C:/Users/win11/WorkBuddy/2026-08-12-16-16-21"

with open(BASE + r"/questions.js", encoding="utf-8") as f:
    js = f.read()
m = re.search(r"window\.QUESTIONS\s*=\s*(\[.*\])\s*;", js, re.S)
QUESTIONS = json.loads(m.group(1))

def norm(s):
    s = s.replace("（", "(").replace("）", ")").replace("　", " ")
    return re.sub(r"\s+", "", s)

def clean_title(s):
    s = re.sub(r"\s*[（(][^（）()]*[）)]\s*$", "", s).strip()
    return s

with open(BASE + r"/pdf_text.txt", encoding="utf-8") as f:
    lines = f.read().split("\n")

start = next(i for i, l in enumerate(lines) if "第一章" in l)
chapter = None
section = None
pdf_q = []
cur = None
opt_re = re.compile(r"^[A-Da-d][、.）) ]")
ans_re = re.compile(r"正确答案|［答案］|\[答案\]|^\s*[√×对错]")
title_re = re.compile(r"^第[一二三四五六七八九十百]+章")
sec_re = re.compile(r"^第[一二三四五六七八九十]+节")
sub_re = re.compile(r"^[一二三四五]、\s*(单选|判断)")
qnum_re = re.compile(r"^(\d+)\.\s*(.*)$")

def flush(c):
    if c is not None:
        pdf_q.append(c)

for l in lines[start:]:
    l = l.strip()
    if not l:
        continue
    if title_re.search(l):
        chapter = clean_title(l); section = None; continue
    if sec_re.search(l):
        section = clean_title(l); continue
    if sub_re.search(l):
        continue
    mm = qnum_re.match(l)
    if mm:
        flush(cur)
        cur = {"chapter": chapter, "section": section, "raw": mm.group(2)}
        continue
    if cur is not None:
        if opt_re.match(l) or ans_re.search(l):
            flush(cur); cur = None; continue
        cur["raw"] += l
flush(cur)

pdf_map = {}
for q in pdf_q:
    pdf_map.setdefault(norm(q["raw"]), (q["chapter"], q["section"] or ""))

for item in QUESTIONS:
    k = norm(item["question"])
    if k in pdf_map:
        item["chapter"] = pdf_map[k][0]
        item["section"] = pdf_map[k][1]
    else:
        item["chapter"] = "未分章"
        item["section"] = ""

out = "window.QUESTIONS = " + json.dumps(QUESTIONS, ensure_ascii=False) + ";\n"
with open(BASE + r"/questions.js", "w", encoding="utf-8") as f:
    f.write(out)

c = Counter(i["chapter"] for i in QUESTIONS)
print("written total:", len(QUESTIONS))
for k, v in c.items():
    print("  ", k, "=>", v)
