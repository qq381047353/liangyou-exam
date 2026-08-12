/* 云端同步：同步码即密钥（PBKDF2 -> AES-GCM），服务器只存密文。
   同步身份用 code 的 SHA-256(id) 标识，原始同步码不上传。 */
(function () {
  "use strict";
  var API = "/api";

  function bytesToB64(bytes) {
    var bin = "", chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function enc() { return new TextEncoder(); }
  function dec() { return new TextDecoder(); }

  function deriveEncKey(code) {
    return crypto.subtle.importKey("raw", enc().encode(code), "PBKDF2", false, ["deriveKey"])
      .then(function (km) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: enc().encode("lsb-sync-salt-v1"), iterations: 120000, hash: "SHA-256" },
          km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }
  function sha256Hex(str) {
    return crypto.subtle.digest("SHA-256", enc().encode(str))
      .then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ("0" + b.toString(16)).slice(-2);
        }).join("");
      });
  }
  function encryptData(code, obj) {
    return deriveEncKey(code).then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc().encode(JSON.stringify(obj)))
        .then(function (ct) {
          var combined = new Uint8Array(iv.length + ct.byteLength);
          combined.set(iv, 0); combined.set(new Uint8Array(ct), iv.length);
          return bytesToB64(combined);
        });
    });
  }
  function decryptData(code, b64) {
    return deriveEncKey(code).then(function (key) {
      var combined = b64ToBytes(b64);
      var iv = combined.slice(0, 12), ct = combined.slice(12);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct)
        .then(function (pt) { return JSON.parse(dec().decode(pt)); });
    });
  }

  function push() {
    var LSB = window.LSB; if (!LSB || !LSB.code()) return Promise.resolve();
    var code = LSB.code();
    return sha256Hex(code).then(function (id) {
      return encryptData(code, LSB.get()).then(function (data) {
        return fetch(API + "/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id, data: data }),
        }).then(function (res) {
          if (!res.ok) throw new Error("push " + res.status);
          if (window.toast) window.toast("已上传到云端");
        });
      });
    });
  }
  function pull() {
    var LSB = window.LSB; if (!LSB || !LSB.code()) return Promise.resolve();
    var code = LSB.code();
    return sha256Hex(code).then(function (id) {
      return fetch(API + "/sync?id=" + encodeURIComponent(id)).then(function (res) {
        if (res.status === 404) { if (window.toast) window.toast("云端暂无数据"); return; }
        if (!res.ok) throw new Error("pull " + res.status);
        return res.json().then(function (j) {
          if (j.data) {
            return decryptData(code, j.data).then(function (obj) {
              LSB.merge(obj);
              if (window.toast) window.toast("已从云端拉取并合并");
            });
          }
        });
      });
    });
  }

  var pushTimer = null;
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push().catch(function () {}); }, 1200);
  }

  function initSync() {
    var LSB = window.LSB;
    if (!LSB) return;
    var setup = document.getElementById("sync-setup");
    var actions = document.getElementById("sync-actions");
    var status = document.getElementById("sync-status");
    var input = document.getElementById("sync-code-input");

    function showActions() {
      setup.style.display = "none"; actions.style.display = "block";
      status.textContent = "已启用同步：数据已加密，自动与云端双向同步。";
    }
    function showSetup() {
      setup.style.display = "block"; actions.style.display = "none";
      status.textContent = "";
    }

    var code = LSB.code();
    if (code) { showActions(); LSB.onChange(schedulePush); pull().catch(function () {}); }
    else showSetup();

    document.getElementById("sync-save-code").onclick = function () {
      var v = input.value.trim();
      if (v.length < 4) { if (window.toast) window.toast("同步码至少 4 位，建议长一点"); return; }
      LSB.setCode(v); showActions(); LSB.onChange(schedulePush);
      if (window.toast) window.toast("同步已启用，正在上传…");
      push().catch(function () { if (window.toast) window.toast("上传失败，请检查网络"); });
    };
    document.getElementById("sync-push").onclick = function () {
      push().catch(function () { if (window.toast) window.toast("上传失败"); });
    };
    document.getElementById("sync-pull").onclick = function () {
      pull().catch(function () { if (window.toast) window.toast("拉取失败"); });
    };
    document.getElementById("sync-change").onclick = function () {
      if (!confirm("更换同步码？本机数据保留，但与此前云端数据断开（需重新上传）。")) return;
      LSB.setCode(""); LSB.onChange(null); showSetup(); input.value = "";
      if (window.toast) window.toast("已解除同步");
    };
  }

  if (!window.crypto || !window.crypto.subtle) {
    // 非安全上下文（如纯 http 公网）：Web Crypto 不可用，禁用同步并提示
    document.addEventListener("DOMContentLoaded", function () {
      var s = document.getElementById("sync-status");
      if (s) s.textContent = "当前环境不支持加密同步（需 https 或 localhost）。";
      var a = document.getElementById("sync-actions"); if (a) a.style.display = "none";
      var su = document.getElementById("sync-setup"); if (su) su.style.display = "none";
    });
  } else {
    document.addEventListener("DOMContentLoaded", initSync);
  }
})();
