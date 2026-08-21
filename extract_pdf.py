import sys
from pypdf import PdfReader

src = r"C:/Users/win11/Documents/xwechat_files/wxid_i5zo3i7z3hf51_7b6c/msg/file/2026-08/粮油保管员练习题(3).pdf"
dst = r"C:/Users/win11/WorkBuddy/2026-08-12-16-16-21/pdf_text.txt"

reader = PdfReader(src)
with open(dst, "w", encoding="utf-8") as f:
    for i, page in enumerate(reader.pages):
        f.write(f"\n=== PAGE {i+1} ===\n")
        txt = page.extract_text() or ""
        f.write(txt)
print("TOTAL PAGES:", len(reader.pages))
print("WROTE:", dst)
