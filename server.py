# -*- coding: utf-8 -*-
"""粮油保管员刷题 —— 单文件后端
- 托管静态文件（index.html / app.js / style.css / questions.js / sync.js）
- 提供 /api/sync 同步接口，存储用户加密数据（服务器只存密文，看不到内容）
- 同步身份 = 同步码的 SHA-256(id)，原始同步码不上传

运行：python server.py [port]   默认 8080
"""
import http.server
import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler

DIR = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(DIR, "sync_store.json")
MAX_BYTES = 2 * 1024 * 1024  # 2MB 上限，防滥用

ALLOWED = {
    "/": "text/html; charset=utf-8",
    "/index.html": "text/html; charset=utf-8",
    "/app.js": "application/javascript; charset=utf-8",
    "/style.css": "text/css; charset=utf-8",
    "/questions.js": "application/javascript; charset=utf-8",
    "/sync.js": "application/javascript; charset=utf-8",
    "/favicon.ico": "image/x-icon",
}


def load_store():
    try:
        with open(STORE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_store(s):
    tmp = STORE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f)
    os.replace(tmp, STORE)  # 原子写，避免并发损坏


class Handler(BaseHTTPRequestHandler):
    server_version = "LSB-Sync/1.0"

    def log_message(self, fmt, *args):
        pass  # 安静

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api_get()
        path = self.path.split("?", 1)[0]
        if path not in ALLOWED:
            self.send_error(404)
            return
        fp = os.path.join(DIR, path.lstrip("/"))
        if not os.path.isfile(fp):
            self.send_error(404)
            return
        with open(fp, "rb") as f:
            data = f.read()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", ALLOWED[path])
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api_post()
        self.send_error(404)

    def _api_get(self):
        if not self.path.startswith("/api/sync"):
            self.send_error(404)
            return
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        idv = (params.get("id") or [""])[0]
        if not idv:
            self.send_error(400)
            return
        store = load_store()
        data = store.get(idv)
        if data is None:
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        body = json.dumps({"data": data}).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_post(self):
        if not self.path.startswith("/api/sync"):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BYTES:
            self.send_error(413 if length > MAX_BYTES else 400)
            return
        try:
            obj = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.send_error(400)
            return
        idv = obj.get("id")
        data = obj.get("data")
        if not isinstance(idv, str) or not isinstance(data, str) or len(data) > MAX_BYTES:
            self.send_error(400)
            return
        store = load_store()
        store[idv] = data
        save_store(store)
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        body = json.dumps({"ok": True}).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    import sys
    # 端口优先级：命令行参数 > 环境变量 $PORT（云平台注入） > 默认 8080
    port = None
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    if port is None:
        env_port = os.environ.get("PORT")
        if env_port and env_port.isdigit():
            port = int(env_port)
    if port is None:
        port = 8080
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("Serving on http://0.0.0.0:%d  (Ctrl+C to stop)" % port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
