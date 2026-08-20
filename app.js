/* 粮油保管员在线刷题 —— 纯前端逻辑，数据存于本机 localStorage */
(function () {
  "use strict";

  var ALL = window.QUESTIONS || [];
  var SINGLE = ALL.filter(function (q) { return q.type === "单选"; });
  var JUDGE = ALL.filter(function (q) { return q.type === "判断"; });

  var LS = {
    wrong: "lsb_wrong_v1",
    fav: "lsb_fav_v1",
    done: "lsb_done_v1",
    theme: "lsb_theme_v1",
    progress: "lsb_progress_v1",
    exam: "lsb_exam_history_v1",
  };

  // 可断点续刷的模式（顺序/随机/单选/判断/模拟考）；错题本、收藏为动态集合，不续
  var RESUMABLE = { all: 1, random: 1, single: 1, judge: 1, exam: 1 };

  // ---------- 存储 ----------
  function load(key, def) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; }
    catch (e) { return def; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  var wrongIds = load(LS.wrong, []);   // 错题 id 数组（去重）
  var favIds = load(LS.fav, []);       // 收藏 id 数组
  var doneIds = load(LS.done, []);     // 已做过 id 数组
  var progress = load(LS.progress, {});// 各模式练习进度 {mode:{ids,answers,idx,ts}}

  var changeCb = null;                 // 云端同步用：数据变更通知
  function notifyChange() { if (changeCb) changeCb(); }

  function addUnique(arr, id) { if (arr.indexOf(id) === -1) arr.push(id); }
  function removeId(arr, id) { var i = arr.indexOf(id); if (i !== -1) arr.splice(i, 1); }

  // 合并外部数据（导入备份 / 云端拉取共用），取并集，避免丢失错题
  function mergeData(d) {
    if (!d || typeof d !== "object") return;
    if (Array.isArray(d.wrong)) d.wrong.forEach(function (id) { if (typeof id === "number") addUnique(wrongIds, id); });
    if (Array.isArray(d.fav)) d.fav.forEach(function (id) { if (typeof id === "number") addUnique(favIds, id); });
    if (Array.isArray(d.done)) d.done.forEach(function (id) { if (typeof id === "number") addUnique(doneIds, id); });
    if (d.progress && typeof d.progress === "object") {
      for (var m in d.progress) {
        if (!RESUMABLE[m]) continue;
        var p = d.progress[m];
        if (p && Array.isArray(p.ids) && p.ids.length && typeof p.answers === "object") {
          progress[m] = { ids: p.ids, answers: p.answers, idx: p.idx || 0, ts: p.ts || 0 };
        }
      }
      save(LS.progress, progress);
    }
    save(LS.wrong, wrongIds); save(LS.fav, favIds); save(LS.done, doneIds);
    renderHome();
  }

  // ---------- 状态 ----------
  var S = {
    mode: "all",
    list: [],
    idx: 0,
    answers: {},        // id -> 用户选择
    sessionWrong: {},   // id -> true
    sessionRight: 0,
    sessionTotal: 0,
    startTime: 0,
    isReview: false,    // 错题/收藏回顾模式
    reviewList: [],
    isExam: false,      // 模拟考模式
    cfg: null,          // 模拟考配置 {count,type,mins,pass}
    examDeadline: 0,    // 模拟考交卷截止时间戳
    examWrongList: [],  // 本次模拟考错题（用于考后回顾）
    lastWasExam: false, // 最近一次结果页是否来自模拟考
  };

  var examHist = load(LS.exam, { best: 0, attempts: 0 });

  // ---------- 工具 ----------
  function $(sel) { return document.querySelector(sel); }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60); s = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }

  // ---------- 屏幕切换 ----------
  var screens = ["#home", "#quiz", "#result", "#wrongbook"];
  function show(name) {
    screens.forEach(function (s) { $(s).classList.toggle("active", s === name); });
    window.scrollTo(0, 0);
  }

  // ---------- 首页 ----------
  function renderHome() {
    $("#st-total").textContent = ALL.length;
    $("#st-wrong").textContent = wrongIds.length;
    $("#st-fav").textContent = favIds.length;
    $("#st-done").textContent = doneIds.length;
    renderResumeHint();
  }

  // 首页「顺序练习」卡片上的续刷提示
  function renderResumeHint() {
    var el = $("#mc-resume-all");
    if (!el) return;
    var p = progress.all;
    if (p && Array.isArray(p.ids) && p.ids.length) {
      var done = 0;
      for (var k in p.answers) if (p.answers.hasOwnProperty(k) && p.answers[k] != null) done++;
      var total = p.ids.length;
      el.textContent = "↳ 继续：已做 " + done + " 题，从第 " + ((p.idx || 0) + 1) + " 题接着刷";
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
    // 模拟考进行中提示
    var eel = $("#mc-resume-exam");
    if (eel) {
      var ep = progress.exam;
      if (ep && Array.isArray(ep.ids) && ep.ids.length && (ep.deadline || 0) > Date.now()) {
        var edone = 0;
        for (var k2 in ep.answers) if (ep.answers.hasOwnProperty(k2) && ep.answers[k2] != null) edone++;
        eel.textContent = "↳ 进行中：已做 " + edone + " 题，剩 " + fmtTime(ep.deadline - Date.now()) + "，点此续考";
        eel.style.display = "block";
      } else {
        eel.style.display = "none";
      }
    }
  }

  function startQuiz(mode) {
    S.isReview = false;
    S.isExam = false;
    S.lastWasExam = false;
    S.mode = mode;
    S.answers = {};
    S.sessionWrong = {};
    S.sessionRight = 0;
    S.sessionTotal = 0;
    S.startTime = Date.now();

    if (mode === "all") S.list = ALL.slice();
    else if (mode === "random") S.list = shuffle(ALL);
    else if (mode === "single") S.list = SINGLE.slice();
    else if (mode === "judge") S.list = JUDGE.slice();
    else if (mode === "wrong") {
      var wset = {}; wrongIds.forEach(function (id) { wset[id] = 1; });
      S.list = ALL.filter(function (q) { return wset[q.id]; });
      if (S.list.length === 0) { toast("还没有错题，先去练几题吧"); return; }
    } else if (mode === "fav") {
      var fset = {}; favIds.forEach(function (id) { fset[id] = 1; });
      S.list = ALL.filter(function (q) { return fset[q.id]; });
      if (S.list.length === 0) { toast("还没有收藏，点星标即可收藏"); return; }
    }

    // 断点续刷：可续模式且存在进度时，恢复题序、作答与位置
    if (RESUMABLE[mode] && restoreProgress(mode)) {
      renderResumeHint();
      show("#quiz");
      renderQuestion();
      return;
    }
    S.idx = 0;
    show("#quiz");
    renderQuestion();
  }

  // 从已存进度恢复当前模式的题序 / 作答 / 位置，返回是否成功
  function restoreProgress(mode) {
    var p = progress[mode];
    if (!p || !Array.isArray(p.ids) || !p.ids.length || typeof p.answers !== "object") return false;
    var byId = {};
    ALL.forEach(function (q) { byId[q.id] = q; });
    var list = [];
    p.ids.forEach(function (id) { if (byId[id]) list.push(byId[id]); });
    if (!list.length) return false;
    // 若当前模式集合比存档更长（如新增题），把缺失题补到末尾，保证全集完整
    if (list.length < S.list.length) {
      S.list.forEach(function (q) { if (list.indexOf(q) === -1) list.push(q); });
    }
    S.list = list;
    S.answers = p.answers;
    S.idx = Math.min(typeof p.idx === "number" ? p.idx : 0, S.list.length - 1);
    S.sessionRight = 0; S.sessionWrong = {}; S.sessionTotal = 0;
    if (typeof p.deadline === "number") S.examDeadline = p.deadline;
    if (p.cfg && typeof p.cfg === "object") S.cfg = p.cfg;
    for (var k in S.answers) {
      if (!S.answers.hasOwnProperty(k)) continue;
      var q = byId[+k];
      if (!q) continue;
      S.sessionTotal++;
      if (S.answers[k] === q.answer) S.sessionRight++;
      else S.sessionWrong[q.id] = true;
    }
    return true;
  }

  // 保存当前模式进度到本地（并随账户云端同步）
  function saveProgress() {
    if (!RESUMABLE[S.mode]) return;
    var rec = {
      ids: S.list.map(function (q) { return q.id; }),
      answers: S.answers,
      idx: S.idx,
      ts: Date.now(),
    };
    if (S.mode === "exam") { rec.deadline = S.examDeadline; rec.cfg = S.cfg; }
    progress[S.mode] = rec;
    save(LS.progress, progress);
    notifyChange();
  }

  // 清除某模式进度（交卷 / 主动重来）
  function clearProgress(mode) {
    if (progress[mode]) { delete progress[mode]; save(LS.progress, progress); notifyChange(); }
  }

  // ---------- 渲染题目 ----------
  function renderQuestion() {
    var q = S.list[S.idx];
    var answered = S.answers[q.id] != null;

    $("#q-tag").textContent = q.type;
    $("#q-tag").className = "tag" + (q.type === "判断" ? " judge" : "");
    $("#q-no").textContent = "第 " + (S.idx + 1) + " / " + S.list.length + " 题" +
      (S.isReview ? "（回顾）" : (S.isExam ? "（模拟考）" : ""));
    $("#q-text").textContent = q.question;

    var html = "";
    if (q.type === "单选") {
      q.options.forEach(function (o) {
        html += '<div class="opt" data-key="' + o.key + '"><div class="k">' + o.key + "</div><div>" + esc(o.text) + "</div></div>";
      });
    } else {
      html += '<div class="opt" data-key="√"><div class="k">√</div><div>正确</div></div>';
      html += '<div class="opt" data-key="×"><div class="k">×</div><div>错误</div></div>';
    }
    var box = $("#options"); box.innerHTML = html;

    // 已作答：练习模式立即判分并展示解析；模拟考仅标记选中，交卷后才揭晓
    if (answered) {
      if (S.isExam) paintSel(q);
      else paintAnswer(q);
    } else {
      $("#analysis").classList.remove("show");
    }

    // 收藏星标
    var starred = favIds.indexOf(q.id) !== -1;
    var star = $("#star");
    star.classList.toggle("on", starred);
    star.textContent = starred ? "★" : "☆";

    // 进度条
    var prog = ((S.idx + (answered ? 1 : 0)) / S.list.length) * 100;
    $("#progress > i").style.width = prog + "%";

    // 底部按钮
    $("#prev-btn").disabled = S.idx === 0;
    var next = $("#next-btn");
    if (S.isExam) {
      next.textContent = (S.idx === S.list.length - 1) ? "交卷" : "下一题";
    } else if (S.idx === S.list.length - 1) {
      next.textContent = S.isReview ? "完成回顾" : "交卷";
    } else {
      next.textContent = "下一题";
    }

    // 回顾模式：始终展示解析
    if (S.isReview) {
      showAnalysis(q, true);
      box.querySelectorAll(".opt").forEach(function (el) {
        var k = el.getAttribute("data-key");
        if (k === q.answer) el.classList.add("correct");
        else el.classList.add("dim");
      });
    }

    bindOptions(q);
  }

  function bindOptions(q) {
    var box = $("#options");
    box.querySelectorAll(".opt").forEach(function (el) {
      el.onclick = function () {
        if (S.isReview) return;
        if (S.isExam) {
          // 模拟考：仅记录/替换作答，不即时判分，可随时修改
          S.answers[q.id] = el.getAttribute("data-key");
          paintSel(q);
          saveProgress();
          renderProgress();
          return;
        }
        if (S.answers[q.id] != null) return; // 已答不可改
        var key = el.getAttribute("data-key");
        S.answers[q.id] = key;

        var right = (key === q.answer);
        if (right) { S.sessionRight++; }
        else { S.sessionWrong[q.id] = true; addUnique(wrongIds, q.id); save(LS.wrong, wrongIds); }
        addUnique(doneIds, q.id); save(LS.done, doneIds);
        saveProgress();
        S.sessionTotal++;
        paintAnswer(q);
        showAnalysis(q, false);
        renderProgress();
        if (!right) renderHome();
        notifyChange();
      };
    });
  }

  // 模拟考：仅高亮用户选中项，不显示对错
  function paintSel(q) {
    var sel = S.answers[q.id];
    var box = $("#options");
    box.querySelectorAll(".opt").forEach(function (el) {
      el.classList.remove("sel", "correct", "wrong", "dim");
      if (el.getAttribute("data-key") === sel) el.classList.add("sel");
    });
  }

  function paintAnswer(q) {
    var sel = S.answers[q.id];
    var box = $("#options");
    box.querySelectorAll(".opt").forEach(function (el) {
      var k = el.getAttribute("data-key");
      el.classList.remove("sel", "correct", "wrong", "dim");
      if (k === q.answer) el.classList.add("correct");
      else if (k === sel) el.classList.add("wrong");
      else el.classList.add("dim");
    });
  }

  function showAnalysis(q, review) {
    var a = $("#analysis");
    a.innerHTML = '<div class="a-head">解析</div><div class="a-ans">正确答案：' +
      esc(q.answer) + "</div><div style='margin-top:6px'>" + esc(q.analysis) + "</div>";
    a.classList.add("show");
  }

  function renderProgress() {
    var answeredCount = 0;
    for (var i = 0; i < S.list.length; i++) if (S.answers[S.list[i].id] != null) answeredCount++;
    $("#progress > i").style.width = (answeredCount / S.list.length) * 100 + "%";
  }

  // ---------- 导航 ----------
  function nextQ() {
    if (S.idx === S.list.length - 1) {
      if (S.isReview) { show("#home"); renderHome(); toast("回顾结束"); }
      else if (S.isExam) finishExam();
      else finishQuiz();
    } else { S.idx++; renderQuestion(); saveProgress(); }
  }
  function prevQ() { if (S.idx > 0) { S.idx--; renderQuestion(); saveProgress(); } }

  function toggleStar() {
    var q = S.list[S.idx];
    var i = favIds.indexOf(q.id);
    if (i === -1) { favIds.push(q.id); save(LS.fav, favIds); toast("已收藏"); }
    else { favIds.splice(i, 1); save(LS.fav, favIds); toast("已取消收藏"); }
    $("#star").classList.toggle("on");
    $("#star").textContent = i === -1 ? "★" : "☆";
    renderHome();
    notifyChange();
  }

  // ---------- 答题卡 ----------
  function openSheet() {
    var grid = $("#sheet-grid"); grid.innerHTML = "";
    for (var i = 0; i < S.list.length; i++) {
      var q = S.list[i];
      var cell = document.createElement("div");
      cell.className = "cell";
      cell.textContent = (i + 1);
      var ans = S.answers[q.id];
      if (S.isExam) {
        // 考试中：只显示已答/未答，不泄露对错
        if (ans != null) cell.classList.add("ans");
      } else if (ans != null) {
        if (ans === q.answer) cell.classList.add("right");
        else cell.classList.add("wrong");
      }
      if (i === S.idx) cell.classList.add("cur");
      (function (idx) { cell.onclick = function () { S.idx = idx; renderQuestion(); closeSheet(); }; })(i);
      grid.appendChild(cell);
    }
    // 图例：考试中去对错化
    var legend = $("#sheet-legend");
    if (legend) {
      if (S.isExam) {
        legend.innerHTML = '<span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>已答</span>' +
          '<span><i style="background:var(--bg);border:1px solid var(--line)"></i>未答</span>';
      } else {
        legend.innerHTML = '<span><i style="background:var(--green-soft);border:1px solid var(--green)"></i>答对</span>' +
          '<span><i style="background:var(--red-soft);border:1px solid var(--red)"></i>答错</span>' +
          '<span><i style="background:var(--bg);border:1px solid var(--line)"></i>未答</span>';
      }
    }
    $("#sheet-submit").style.display = S.isExam ? "block" : "none";
    $("#sheet-mask").classList.add("show");
  }
  function closeSheet() { $("#sheet-mask").classList.remove("show"); }

  // ---------- 交卷 / 结果 ----------
  function finishQuiz() {
    clearProgress(S.mode);
    S.lastWasExam = false;
    var total = S.sessionTotal || S.list.length;
    var right = S.sessionRight;
    var rate = total ? Math.round((right / total) * 100) : 0;
    $("#r-rate").textContent = rate + "%";
    $("#r-sub").textContent = "共 " + total + " 题 · 用时 " + fmtTime(Date.now() - S.startTime);
    $("#r-right").textContent = right;
    $("#r-wrong").textContent = (total - right);
    show("#result");
  }

  // ---------- 模拟考试 ----------
  function buildPool(type) {
    if (type === "single") return SINGLE.slice();
    if (type === "judge") return JUDGE.slice();
    return ALL.slice(); // mix
  }

  function readExamCfg() {
    var count = parseInt($("#exam-count .on").getAttribute("data-v"), 10);
    var type = $("#exam-type .on").getAttribute("data-v");
    var mins = parseInt($("#exam-mins").value, 10);
    if (!mins || mins < 1) mins = 90;
    var pass = parseInt($("#exam-pass .on").getAttribute("data-v"), 10) || 60;
    return { count: count, type: type, mins: mins, pass: pass };
  }

  function startExam(cfg) {
    S.isExam = true;
    S.lastWasExam = false;
    S.mode = "exam";
    S.cfg = cfg;
    var pool = buildPool(cfg.type);
    var count = cfg.count === 0 ? pool.length : Math.min(cfg.count, pool.length);
    S.list = shuffle(pool).slice(0, count);
    S.answers = {};
    S.sessionWrong = {};
    S.sessionRight = 0;
    S.sessionTotal = 0;
    S.idx = 0;
    S.startTime = Date.now();
    S.examDeadline = Date.now() + cfg.mins * 60000;
    saveProgress();
    show("#quiz");
    renderQuestion();
  }

  function openExamConfig() {
    renderExamHistory();
    $("#exam-mask").classList.add("show");
  }
  function closeExamConfig() { $("#exam-mask").classList.remove("show"); }

  // 点击模拟考卡片：有进行中的考试则续刷，否则打开配置
  function onExamCard() {
    var p = progress.exam;
    if (p && Array.isArray(p.ids) && p.ids.length && (p.deadline || 0) > Date.now()) {
      resumeExam();
    } else {
      if (p && (p.deadline || 0) <= Date.now()) clearProgress("exam");
      openExamConfig();
    }
  }

  function resumeExam() {
    S.isExam = true;
    S.lastWasExam = false;
    S.mode = "exam";
    if (restoreProgress("exam")) { show("#quiz"); renderQuestion(); }
    else openExamConfig();
  }

  function finishExam() {
    var total = S.list.length;
    var right = 0;
    var wrongList = [];
    S.list.forEach(function (q) {
      var a = S.answers[q.id];
      if (a != null && a === q.answer) right++;
      else { wrongList.push(q); addUnique(wrongIds, q.id); }
    });
    save(LS.wrong, wrongIds); // 模拟考错题并入全局错题本
    var rate = total ? Math.round((right / total) * 100) : 0;
    var pass = rate >= (S.cfg ? S.cfg.pass : 60);
    $("#r-rate").textContent = rate + "%";
    $("#r-pass").textContent = pass ? "✓ 及格" : "✗ 不及格";
    $("#r-pass").className = "r-pass " + (pass ? "ok" : "no");
    $("#r-sub").textContent = "共 " + total + " 题 · 答对 " + right + " · 用时 " + fmtTime(Date.now() - S.startTime);
    $("#r-right").textContent = right;
    $("#r-wrong").textContent = (total - right);
    S.examWrongList = wrongList;
    S.lastWasExam = true;
    clearProgress("exam");
    recordExamHistory(right, total, pass);
    renderHome();
    show("#result");
  }

  function recordExamHistory(right, total, pass) {
    var rate = total ? Math.round((right / total) * 100) : 0;
    examHist.attempts = (examHist.attempts || 0) + 1;
    if (rate > (examHist.best || 0)) examHist.best = rate;
    examHist.lastRate = rate;
    examHist.lastPass = pass;
    examHist.lastCfg = S.cfg;
    save(LS.exam, examHist);
  }

  function renderExamHistory() {
    var el = $("#exam-history");
    if (!el) return;
    if (!examHist.attempts) { el.style.display = "none"; el.textContent = ""; return; }
    el.style.display = "block";
    el.textContent = "已考 " + examHist.attempts + " 次 · 最佳 " + examHist.best +
      "% · 上次 " + (examHist.lastRate || 0) + "%（" + (examHist.lastPass ? "及格" : "不及格") + "）";
  }

  // 考后回顾本场错题
  function reviewExamWrong() {
    if (!S.examWrongList.length) { toast("本场没有错题"); return; }
    startReview(S.examWrongList, 0);
  }

  // ---------- 错题 / 收藏 ----------
  function openWrongBook(tab) {
    S.wbTab = tab || "wrong";
    $("#tab-wrong").classList.toggle("on", S.wbTab === "wrong");
    $("#tab-fav").classList.toggle("on", S.wbTab === "fav");
    renderWB();
    show("#wrongbook");
  }
  function renderWB() {
    var ids = S.wbTab === "wrong" ? wrongIds : favIds;
    var set = {}; ids.forEach(function (id) { set[id] = 1; });
    var list = ALL.filter(function (q) { return set[q.id]; });
    var box = $("#wb-list"); box.innerHTML = "";
    var prac = $("#wb-practice");
    if (list.length) { prac.style.display = "block"; prac.textContent = "开始练习（" + list.length + " 题）"; }
    else prac.style.display = "none";
    $("#wb-clear").style.display = list.length ? "block" : "none";
    if (list.length === 0) {
      box.innerHTML = '<div class="empty">' + (S.wbTab === "wrong" ? "暂无错题，继续保持～" : "还没有收藏，答题时点 ☆ 即可") + "</div>";
      return;
    }
    list.forEach(function (q, i) {
      var item = document.createElement("div");
      item.className = "item";
      var ansTxt = "正确答案：" + esc(q.answer);
      item.innerHTML =
        '<span class="badge' + (q.type === "判断" ? " judge" : "") + '">' + q.type + "</span>" +
        '<div class="it-text">' + esc(q.question) +
        '<div class="it-ans">' + ansTxt + "</div></div>" +
        '<div class="it-del" title="移除">✕</div>';
      item.querySelector(".it-text").onclick = function () { startReview(list, i); };
      item.querySelector(".it-del").onclick = function (e) {
        e.stopPropagation();
        if (S.wbTab === "wrong") { removeId(wrongIds, q.id); save(LS.wrong, wrongIds); }
        else { removeId(favIds, q.id); save(LS.fav, favIds); }
        renderWB(); renderHome(); toast("已移除");
      };
      box.appendChild(item);
    });
  }
  function clearWB() {
    if (!confirm("确定清空" + (S.wbTab === "wrong" ? "所有错题" : "所有收藏") + "？此操作不可恢复。")) return;
    if (S.wbTab === "wrong") { wrongIds = []; save(LS.wrong, wrongIds); }
    else { favIds = []; save(LS.fav, favIds); }
    renderWB(); renderHome(); notifyChange(); toast("已清空");
  }

  // ---------- 回顾模式 ----------
  function startReview(list, startIdx) {
    S.isReview = true;
    S.isExam = false;
    S.reviewList = list;
    S.list = list;
    S.idx = startIdx || 0;
    show("#quiz");
    renderQuestion();
  }

  // ---------- 主题 ----------
  function applyTheme(t) {
    if (t === "dark") document.body.classList.add("dark");
    else document.body.classList.remove("dark");
  }
  function toggleTheme() {
    var cur = document.body.classList.contains("dark") ? "dark" : "light";
    var next = cur === "dark" ? "light" : "dark";
    applyTheme(next); save(LS.theme, next);
  }

  // ---------- 数据备份 / 恢复 ----------
  function exportData() {
    var data = {
      app: "粮油保管员刷题",
      v: 1,
      exportedAt: new Date().toISOString(),
      wrong: wrongIds,
      fav: favIds,
      done: doneIds,
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var fname = "粮油保管员错题备份_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";
    var a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("已导出备份文件");
  }
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!data || typeof data !== "object") throw new Error("格式错误");
        var nw = Array.isArray(data.wrong) ? data.wrong.length : 0;
        var nf = Array.isArray(data.fav) ? data.fav.length : 0;
        mergeData(data);
        notifyChange();
        toast("已导入并合并：错题+" + nw + " 收藏+" + nf);
      } catch (err) {
        toast("导入失败：文件格式不正确");
      }
    };
    reader.readAsText(file);
  }

  // ---------- 绑定 ----------
  function bind() {
    document.querySelectorAll(".mode-card").forEach(function (el) {
      var mode = el.getAttribute("data-mode");
      el.onclick = function () {
        if (mode === "wrong" || mode === "fav") openWrongBook(mode);
        else if (mode === "exam") onExamCard();
        else startQuiz(mode);
      };
    });
    $("#prev-btn").onclick = prevQ;
    $("#next-btn").onclick = nextQ;
    $("#star").onclick = toggleStar;
    $("#sheet-btn").onclick = openSheet;
    $("#sheet-mask").onclick = function (e) { if (e.target === this) closeSheet(); };
    $("#quiz-back").onclick = function () { if (S.isReview) { S.isReview = false; openWrongBook(S.wbTab); } else { saveProgress(); show("#home"); renderHome(); } };
    $("#quiz-restart").onclick = function () {
      if (!confirm("重新开始？当前进度将清空，从第 1 题开始。")) return;
      clearProgress(S.mode);
      S.answers = {}; S.sessionWrong = {}; S.sessionRight = 0; S.sessionTotal = 0;
      if (S.isExam) {
        S.idx = 0;
        S.examDeadline = Date.now() + (S.cfg ? S.cfg.mins : 90) * 60000;
        saveProgress(); renderQuestion(); renderResumeHint();
        toast("已重新开始");
        return;
      }
      if (S.mode === "all") S.list = ALL.slice();
      else if (S.mode === "random") S.list = shuffle(ALL);
      else if (S.mode === "single") S.list = SINGLE.slice();
      else if (S.mode === "judge") S.list = JUDGE.slice();
      S.idx = 0; renderQuestion(); renderResumeHint();
      toast("已重新开始");
    };
    $("#result-home").onclick = function () { show("#home"); renderHome(); };
    $("#result-again").onclick = function () { if (S.lastWasExam && S.cfg) startExam(S.cfg); else startQuiz(S.mode); };
    $("#result-wrong").onclick = function () { if (S.lastWasExam) reviewExamWrong(); else openWrongBook("wrong"); };
    $("#wb-back").onclick = function () { show("#home"); renderHome(); };
    $("#tab-wrong").onclick = function () { openWrongBook("wrong"); };
    $("#tab-fav").onclick = function () { openWrongBook("fav"); };
    $("#wb-clear").onclick = clearWB;
    $("#wb-practice").onclick = function () { startQuiz(S.wbTab); };
    // 模拟考配置：分段选择 + 开始/取消 + 答题卡交卷
    function bindSeg(id) {
      var box = $("#" + id);
      if (!box) return;
      box.querySelectorAll("span").forEach(function (sp) {
        sp.onclick = function () {
          box.querySelectorAll("span").forEach(function (x) { x.classList.remove("on"); });
          sp.classList.add("on");
        };
      });
    }
    bindSeg("exam-count"); bindSeg("exam-type"); bindSeg("exam-pass");
    $("#exam-cancel").onclick = closeExamConfig;
    $("#exam-start").onclick = function () { var cfg = readExamCfg(); closeExamConfig(); startExam(cfg); };
    $("#sheet-submit").onclick = function () { closeSheet(); finishExam(); };

    $("#theme-btn").onclick = toggleTheme;
    $("#export-btn").onclick = exportData;
    $("#import-btn").onclick = function () { $("#import-file").click(); };
    $("#import-file").onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = "";
    };
  }

  // ---------- 云端同步桥接（由 sync.js 调用） ----------
  window.LSB = {
    get: function () { return { wrong: wrongIds.slice(), fav: favIds.slice(), done: doneIds.slice(), progress: JSON.parse(JSON.stringify(progress)) }; },
    merge: function (d) { mergeData(d); },
    onChange: function (cb) { changeCb = cb; },
  };
  window.toast = toast;

  // ---------- 初始化 ----------
  function init() {
    applyTheme(load(LS.theme, null) ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    bind();
    renderHome();
    show("#home");
    // 计时器：练习模式显示已用时间；模拟考显示剩余时间，归零自动交卷
    setInterval(function () {
      if (!$("#quiz").classList.contains("active")) return;
      if (S.isExam) {
        var rem = S.examDeadline - Date.now();
        if (rem <= 0) { $("#timer").textContent = "00:00"; finishExam(); return; }
        $("#timer").textContent = fmtTime(rem);
        $("#timer").classList.toggle("warn", rem <= 60000);
      } else if (!S.isReview) {
        $("#timer").textContent = fmtTime(Date.now() - S.startTime);
      }
    }, 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
