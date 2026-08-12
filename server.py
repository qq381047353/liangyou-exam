# -*- coding: utf-8 -*-
"""粮油保管员刷题 —— 单文件后端（账户体系 + 数据库版）
- 托管静态文件（index.html / app.js / style.css / questions.js / sync.js）
- 使用 SQLite 存储用户账户与同步数据（零第三方依赖）
- 注册 / 登录 / 登出：密码用 PBKDF2-HMAC-SHA256 + 随机盐哈希，会话用随机 token
- 同步接口需登录（token），按用户隔离数据

运行：python server.py [port]   默认 8080；云平台通过环境变量 $PORT 注入。
"""
import hashlib
import json
import os
import secrets
import sqlite3
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DIR, "sync.db")
MAX_BYTES = 2 * 1024 * 1024  # 2MB 上限，防滥用
PBKDF2_ITERS = 200000
TOKEN_TTL_DAYS = 30

ALLOWED = {
    "/": "text/html; charset=utf-8",
    "/index.html": "text/html; charset=utf-8",
    "/app.js": "application/javascript; charset=utf-8",
    "/style.css": "text/css; charset=utf-8",
    "/questions.js": "application/javascript; charset=utf-8",
    "/sync.js": "application/javascript; charset=utf-8",
    "/favicon.ico": "image/x-icon",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    try:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                pw_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS sync_data (
                user_id INTEGER PRIMARY KEY,
                wrong TEXT NOT NULL DEFAULT '[]',
                fav TEXT NOT NULL DEFAULT '[]',
                done TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )"""
        )
        conn.commit()
    finally:
        conn.close()


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERS
    ).hex()
    return pw_hash, salt


def valid_username(u):
    if not isinstance(u, str):
        return False
    if not (3 <= len(u) <= 32):
        return False
    return all(c.isalnum() or c in "_-" for c in u)


def valid_password(p):
    return isinstance(p, str) and 6 <= len(p) <= 128


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=TOKEN_TTL_DAYS)).isoformat()
    conn = db()
    try:
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)",
            (token, user_id, expires),
        )
        conn.commit()
    finally:
        conn.close()
    return token


def user_from_token(token):
    if not token:
        return None
    conn = db()
    try:
        row = conn.execute(
            "SELECT user_id, expires_at FROM sessions WHERE token=?", (token,)
        ).fetchone()
        if not row:
            return None
        expires = datetime.fromisoformat(row["expires_at"])
        if expires < datetime.now(timezone.utc):
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
            conn.commit()
            return None
        return row["user_id"]
    finally:
        conn.close()


def get_token_from_request(handler):
    auth = handler.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    t = handler.headers.get("X-Auth-Token", "")
    if t:
        return t
    # 也支持 query 参数（便于排查）
    qs = urllib.parse.urlparse(handler.path).query
    params = urllib.parse.parse_qs(qs)
    return (params.get("token") or [""])[0]


class Handler(BaseHTTPRequestHandler):
    server_version = "LSB-Sync/2.0"

    def log_message(self, fmt, *args):
        pass  # 安静

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token")

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BYTES:
            return None, (413 if length > MAX_BYTES else 400)
        try:
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8")), None
        except Exception:
            return None, 400

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api_get()
        path = self.path.split("?", 1)[0]
        if path == "/" or path == "":
            path = "/index.html"
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
        if self.path.startswith("/api/auth/me"):
            uid = user_from_token(get_token_from_request(self))
            if uid is None:
                return self._send_json(401, {"error": "未登录"})
            conn = db()
            try:
                u = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
            finally:
                conn.close()
            if not u:
                return self._send_json(401, {"error": "账户不存在"})
            return self._send_json(200, {"username": u["username"]})

        if self.path.startswith("/api/sync"):
            uid = user_from_token(get_token_from_request(self))
            if uid is None:
                return self._send_json(401, {"error": "未登录"})
            conn = db()
            try:
                row = conn.execute(
                    "SELECT wrong, fav, done FROM sync_data WHERE user_id=?", (uid,)
                ).fetchone()
            finally:
                conn.close()
            if row:
                return self._send_json(
                    200, {"wrong": json.loads(row["wrong"]), "fav": json.loads(row["fav"]), "done": json.loads(row["done"])}
                )
            return self._send_json(200, {"wrong": [], "fav": [], "done": []})

        return self.send_error(404)

    def _api_post(self):
        if self.path.startswith("/api/auth/register"):
            obj, err = self._read_json_body()
            if err:
                return self.send_error(err)
            username = (obj.get("username") or "").strip()
            password = obj.get("password") or ""
            if not valid_username(username):
                return self._send_json(400, {"error": "用户名需 3-32 位，仅字母数字及 _ -"})
            if not valid_password(password):
                return self._send_json(400, {"error": "密码需 6-128 位"})
            conn = db()
            try:
                exists = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
                if exists:
                    return self._send_json(409, {"error": "用户名已被注册"})
                pw_hash, salt = hash_password(password)
                cur = conn.execute(
                    "INSERT INTO users (username, pw_hash, salt, created_at) VALUES (?,?,?,?)",
                    (username, pw_hash, salt, now_iso()),
                )
                uid = cur.lastrowid
                conn.commit()
            finally:
                conn.close()
            token = create_session(uid)
            return self._send_json(200, {"ok": True, "token": token, "username": username})

        if self.path.startswith("/api/auth/login"):
            obj, err = self._read_json_body()
            if err:
                return self.send_error(err)
            username = (obj.get("username") or "").strip()
            password = obj.get("password") or ""
            conn = db()
            try:
                u = conn.execute("SELECT id, pw_hash, salt FROM users WHERE username=?", (username,)).fetchone()
                if not u:
                    return self._send_json(401, {"error": "用户名或密码错误"})
                pw_hash, _ = hash_password(password, u["salt"])
                if pw_hash != u["pw_hash"]:
                    return self._send_json(401, {"error": "用户名或密码错误"})
                uid = u["id"]
            finally:
                conn.close()
            token = create_session(uid)
            return self._send_json(200, {"ok": True, "token": token, "username": username})

        if self.path.startswith("/api/auth/logout"):
            token = get_token_from_request(self)
            conn = db()
            try:
                conn.execute("DELETE FROM sessions WHERE token=?", (token,))
                conn.commit()
            finally:
                conn.close()
            return self._send_json(200, {"ok": True})

        if self.path.startswith("/api/sync"):
            uid = user_from_token(get_token_from_request(self))
            if uid is None:
                return self._send_json(401, {"error": "未登录"})
            obj, err = self._read_json_body()
            if err:
                return self.send_error(err)
            wrong = obj.get("wrong")
            fav = obj.get("fav")
            done = obj.get("done")
            if not (isinstance(wrong, list) and isinstance(fav, list) and isinstance(done, list)):
                return self._send_json(400, {"error": "数据格式错误"})
            conn = db()
            try:
                conn.execute(
                    """INSERT INTO sync_data (user_id, wrong, fav, done, updated_at)
                       VALUES (?,?,?,?,?)
                       ON CONFLICT(user_id) DO UPDATE SET
                         wrong=excluded.wrong, fav=excluded.fav, done=excluded.done, updated_at=excluded.updated_at""",
                    (uid, json.dumps(wrong), json.dumps(fav), json.dumps(done), now_iso()),
                )
                conn.commit()
            finally:
                conn.close()
            return self._send_json(200, {"ok": True})

        return self.send_error(404)


def main():
    import sys
    port = None
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    if port is None:
        env_port = os.environ.get("PORT")
        if env_port and env_port.isdigit():
            port = int(env_port)
    if port is None:
        port = 8080
    init_db()
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("Serving on http://0.0.0.0:%d  (Ctrl+C to stop)" % port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
