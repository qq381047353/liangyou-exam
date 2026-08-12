/* 账户与云端同步（token 认证版）
   - 注册 / 登录 / 登出：调用 /api/auth/*
   - 登录后错题、收藏、已做自动同步到服务器数据库（按账户隔离）
   - 传输走 HTTPS（部署到公网必须 https）；localhost 为安全上下文也可
   依赖：window.LSB.get() / LSB.merge() / LSB.onChange()（由 app.js 提供）
*/
(function () {
  "use strict";
  var API = "/api";

  var TOKEN_KEY = "lsb_token";
  var USER_KEY = "lsb_user";

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {} }
  function getUsername() { try { return localStorage.getItem(USER_KEY) || ""; } catch (e) { return ""; } }
  function setUsername(u) { try { localStorage.setItem(USER_KEY, u); } catch (e) {} }

  function isLoggedIn() { return !!getToken(); }

  function authHeaders() {
    return { "Content-Type": "application/json", "X-Auth-Token": getToken() };
  }

  function req(method, path, body) {
    var opts = { method: method, headers: authHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path, opts).then(function (res) {
      return res.json().then(function (j) { return { ok: res.ok, status: res.status, data: j }; });
    });
  }

  // ---------- 网络：注册/登录/登出 ----------
  function register(username, password) {
    return req("POST", "/auth/register", { username: username, password: password }).then(function (r) {
      if (!r.ok) throw new Error(r.data.error || "注册失败");
      setToken(r.data.token); setUsername(r.data.username);
      return r.data.username;
    });
  }
  function login(username, password) {
    return req("POST", "/auth/login", { username: username, password: password }).then(function (r) {
      if (!r.ok) throw new Error(r.data.error || "登录失败");
      setToken(r.data.token); setUsername(r.data.username);
      return r.data.username;
    });
  }
  function logout() {
    var t = getToken();
    setToken(""); setUsername("");
    if (!t) return Promise.resolve();
    return req("POST", "/auth/logout").catch(function () {});
  }

  // ---------- 网络：同步 ----------
  function push() {
    var LSB = window.LSB;
    if (!LSB || !isLoggedIn()) return Promise.resolve();
    return req("POST", "/sync", LSB.get()).then(function (r) {
      if (!r.ok) throw new Error("push " + r.status);
      if (window.toast) window.toast("已同步到云端");
    });
  }
  function pull() {
    var LSB = window.LSB;
    if (!LSB || !isLoggedIn()) return Promise.resolve();
    return req("GET", "/sync").then(function (r) {
      if (r.status === 401) { setToken(""); setUsername(""); render(); throw new Error("登录失效"); }
      if (!r.ok) throw new Error("pull " + r.status);
      LSB.merge(r.data);
      if (window.toast) window.toast("已从云端拉取并合并");
    });
  }

  var pushTimer = null;
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push().catch(function () {}); }, 1200);
  }

  // ---------- UI：账户卡片 ----------
  function el(id) { return document.getElementById(id); }

  function render() {
    var body = el("account-body");
    if (!body) return;
    if (isLoggedIn()) {
      body.innerHTML =
        '<div class="bc-desc">已登录：<b>' + escapeHtml(getUsername()) + '</b>　错题与收藏已自动同步到云端。</div>' +
        '<div class="bottombar" style="margin-top:12px">' +
        '  <button id="acc-sync" class="btn">立即同步</button>' +
        '  <button id="acc-logout" class="btn">退出登录</button>' +
        '</div>';
      el("acc-sync").onclick = function () {
        pull().then(push).catch(function (e) { if (window.toast) window.toast(e.message); });
      };
      el("acc-logout").onclick = function () {
        logout().then(function () { render(); if (window.toast) window.toast("已退出"); });
      };
    } else {
      body.innerHTML =
        '<div class="bc-desc">注册账户后，你的错题与收藏会存进云端数据库，任意电脑/手机登录同一账户即可同步。</div>' +
        '<input id="acc-user" type="text" placeholder="用户名（3-32 位，字母数字 _ -）" maxlength="32" class="acc-input" />' +
        '<input id="acc-pass" type="password" placeholder="密码（6-128 位）" maxlength="128" class="acc-input" />' +
        '<div class="bottombar" style="margin-top:12px">' +
        '  <button id="acc-login" class="btn">登录</button>' +
        '  <button id="acc-register" class="btn primary">注册</button>' +
        '</div>';
      el("acc-register").onclick = function () {
        var u = el("acc-user").value.trim(), p = el("acc-pass").value;
        register(u, p).then(function (name) {
          render(); if (window.toast) window.toast("注册成功，已登录：" + name);
          pull().catch(function () {});
        }).catch(function (e) { if (window.toast) window.toast(e.message); });
      };
      el("acc-login").onclick = function () {
        var u = el("acc-user").value.trim(), p = el("acc-pass").value;
        login(u, p).then(function (name) {
          render(); if (window.toast) window.toast("登录成功：" + name);
          pull().catch(function () {});
        }).catch(function (e) { if (window.toast) window.toast(e.message); });
      };
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function init() {
    var LSB = window.LSB;
    if (LSB) LSB.onChange(schedulePush);
    render();
    if (isLoggedIn()) {
      // 验证 token 是否仍然有效，并拉取云端数据
      req("GET", "/auth/me").then(function (r) {
        if (r.ok) { pull().catch(function () {}); }
        else { setToken(""); setUsername(""); render(); }
      }).catch(function () { /* 离线时不强制登出 */ });
    }
  }

  // 暴露给外部（如调试）
  window.Sync = { isLoggedIn: isLoggedIn, getUsername: getUsername, register: register, login: login, logout: logout, push: push, pull: pull };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
