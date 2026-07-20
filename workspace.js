/* ============================================================================
 * workspace.js — Ticket Workspace + Station 360° (mobile-first bottom sheet).
 * Mở khi chọn ticket/trạm. 4 tab: Tổng quan · Lịch sử · Vật tư · Copilot.
 * Tái dùng dữ liệu qua window.Providers; giữ nguyên mọi tính năng map cũ.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const E = (s) => (typeof esc === "function" ? esc(s) : String(s == null ? "" : s));
  const P = () => global.Providers;
  // config.js/app.js dùng const/let -> GLOBAL LEXICAL, không phải window.* -> đọc có guard.
  const TICKETS = () => (typeof tickets !== "undefined" && tickets ? tickets : []);
  const BCOLOR_G = () => (typeof BCOLOR !== "undefined" && BCOLOR ? BCOLOR : {});
  const COPILOT_URL = () => (typeof COPILOT_API_URL !== "undefined" ? COPILOT_API_URL : null);
  const COPILOT_TOK = () => (typeof COPILOT_TOKEN !== "undefined" ? COPILOT_TOKEN : null);
  const CCTS_URL = (id) => (typeof CCTS_TICKET_URL !== "undefined" ? CCTS_TICKET_URL(id) : "");

  let ws = { code: null, ticketId: null, tab: "overview", state: "half" };

  // ---------------- mount ----------------
  function mount() {
    if ($("ws")) return;
    const el = document.createElement("div");
    el.id = "ws-root";
    el.innerHTML = `
      <div id="ws-backdrop"></div>
      <section id="ws" class="half" role="dialog" aria-label="Ticket Workspace">
        <div id="ws-grab"><span></span></div>
        <header id="ws-head"></header>
        <nav id="ws-tabs">
          <button data-t="overview" class="on">Tổng quan</button>
          <button data-t="history">Lịch sử</button>
          <button data-t="parts">Vật tư</button>
          <button data-t="copilot">Copilot</button>
        </nav>
        <div id="ws-body"></div>
      </section>`;
    document.body.appendChild(el);
    $("ws-backdrop").onclick = close;
    $("ws-tabs").querySelectorAll("button").forEach((b) => (b.onclick = () => setTab(b.dataset.t)));
    setupDrag();
  }

  function setupDrag() {
    const grab = $("ws-grab"), sheet = $("ws");
    let y0 = null, h0 = 0;
    const start = (y) => { y0 = y; h0 = sheet.getBoundingClientRect().height; sheet.style.transition = "none"; };
    const move = (y) => { if (y0 == null) return; const dy = y - y0; sheet.style.height = Math.max(120, h0 - dy) + "px"; };
    const end = () => {
      if (y0 == null) return; sheet.style.transition = ""; const h = sheet.getBoundingClientRect().height;
      const vh = innerHeight; sheet.style.height = "";
      if (h < vh * 0.28) close(); else setState(h > vh * 0.62 ? "full" : "half"); y0 = null;
    };
    grab.addEventListener("touchstart", (e) => start(e.touches[0].clientY), { passive: true });
    grab.addEventListener("touchmove", (e) => move(e.touches[0].clientY), { passive: true });
    grab.addEventListener("touchend", end);
    grab.addEventListener("mousedown", (e) => { start(e.clientY); const mm = (ev) => move(ev.clientY), mu = () => { end(); removeEventListener("mousemove", mm); removeEventListener("mouseup", mu); }; addEventListener("mousemove", mm); addEventListener("mouseup", mu); });
    grab.addEventListener("click", () => setState(ws.state === "full" ? "half" : "full"));
  }

  function setState(s) { ws.state = s; const el = $("ws"); el.classList.remove("half", "full"); el.classList.add(s); }
  function setTab(t) {
    ws.tab = t;
    $("ws-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    renderBody();
  }

  // ---------------- open / close ----------------
  function open(stationCode, ticketId) {
    mount();
    ws.code = stationCode; ws.tab = "overview";
    // nạp lịch sử trạm (lazy) — hàm có sẵn ở app.js
    if (typeof loadStationHistory === "function") loadStationHistory(stationCode, null);
    const opens = P().getStationTicketsOpen(stationCode);
    ws.ticketId = ticketId || (opens[0] && opens[0].id) || null;
    $("ws-root").classList.add("show"); setState("half"); setTab("overview");
    renderHead();
  }
  function close() { const r = $("ws-root"); if (r) r.classList.remove("show"); ws.code = null; }

  // ---------------- header (sticky) ----------------
  function renderHead() {
    const prof = P().getStationProfile(ws.code);
    const opens = P().getStationTicketsOpen(ws.code);
    const cur = P().getTicketSummary(ws.ticketId) || opens[0] || null;
    const t = cur && TICKETS().find((x) => x.id === cur.id);
    const sla = t && typeof remText === "function" ? remText(t) : "—";
    const bucket = t && typeof bucketOf === "function" ? bucketOf(t) : "b99";
    const col = (BCOLOR_G()[bucket]) || "#64748b";
    const switcher = opens.length > 1
      ? `<select id="ws-tk">${opens.map((o) => `<option value="${E(o.id)}"${o.id === (cur && cur.id) ? " selected" : ""}>${E(o.err || o.id)} · ${o.rej ? "⛔" : ""}${E(o.status)}</option>`).join("")}</select>` : "";
    $("ws-head").innerHTML = `
      <div class="ws-hrow">
        <div class="ws-title">${E(prof.code)} <span class="ws-badge">${E(prof.type)}</span>
          ${cur && cur.rej ? '<span class="ws-badge rej">⛔ VOMS REJECT</span>' : ""}
          ${cur && cur.model ? `<span class="ws-badge">${E(cur.model)}</span>` : ""}</div>
        <button id="ws-close" aria-label="Đóng">✕</button>
      </div>
      <div class="ws-hrow2">
        <span class="ws-sla" style="background:${col}">${E(sla)}</span>
        <span class="ws-tid">${E(cur ? cur.id : "—")}</span>
        <span class="ws-status">${E(cur ? cur.status : "")}</span>
      </div>
      ${switcher ? `<div class="ws-hrow2">Ticket tại trạm: ${switcher}</div>` : ""}`;
    $("ws-close").onclick = close;
    if ($("ws-tk")) $("ws-tk").onchange = (e) => { ws.ticketId = e.target.value; renderHead(); renderBody(); };
  }

  // ---------------- body dispatch ----------------
  function renderBody() {
    renderHead();
    const b = $("ws-body");
    if (ws.tab === "overview") b.innerHTML = overviewHtml();
    else if (ws.tab === "history") b.innerHTML = historyHtml();
    else if (ws.tab === "parts") b.innerHTML = partsHtml();
    else if (ws.tab === "copilot") { b.innerHTML = copilotShell(); Copilot.bind(); }
    wireBody();
  }

  // ---------------- Tab 1: Tổng quan ----------------
  function overviewHtml() {
    const s = P().getTicketSummary(ws.ticketId);
    const prof = P().getStationProfile(ws.code);
    if (!s) return `<div class="ws-empty">Không có ticket mở tại trạm này.<br>Xem tab Lịch sử để tra tác động trước đây.</div>`;
    const row = (k, v, cp) => `<div class="ws-kv"><span>${E(k)}</span><b>${v || "<i class='muted'>Chưa đồng bộ</i>"}${cp ? ` <button class="ws-copy" data-copy="${E(cp)}">⧉</button>` : ""}</b></div>`;
    const notesH = typeof notesHtml === "function" ? notesHtml(ws.code) : "";
    const fixH = typeof fixHtml === "function" ? fixHtml(ws.code) : "";
    const dl = s.deadline ? new Date(s.deadline).toLocaleString("vi") : "";
    const ct = s.createMs ? new Date(s.createMs).toLocaleString("vi") : "";
    const mapsUrl = prof.pos ? `https://www.google.com/maps/dir/?api=1&destination=${prof.pos[0]},${prof.pos[1]}` : "";
    return `
      <div class="ws-actions">
        ${mapsUrl ? `<a class="ws-btn" href="${mapsUrl}" target="_blank" rel="noopener">🧭 Dẫn đường</a>` : ""}
        <button class="ws-btn" data-copy="${E(s.id)}">⧉ Ticket ID</button>
        <button class="ws-btn" data-copy="${E(s.stationCode)}">⧉ Mã trạm</button>
        ${s.cpid ? `<button class="ws-btn" data-copy="${E(s.cpid)}">⧉ Charge Point</button>` : ""}
        <button class="ws-btn" id="ws-ccts">↗ Mở CCTS</button>
      </div>
      <div class="ws-card">
        ${row("Ticket", E(s.name || s.id))}
        ${row("Station Code", E(s.stationCode), s.stationCode)}
        ${row("Charge Point ID", E(s.cpid), s.cpid)}
        ${row("Loại", prof.type)}
        ${row("Model", E(s.model))}
        ${row("BOM", E(s.bom))}
        ${row("Firmware", E(s.firmware))}
        ${row("Error Code", E(s.err))}
        ${row("Trạng thái", E(s.status) + (s.rej ? " · ⛔ REJECT" : ""))}
        ${row("Owner", E(s.owner))}
        ${row("Collaborators", E(s.collab))}
        ${row("Urgency", E(s.urgency))}
        ${row("Create Time", E(ct))}
        ${row("Deadline", E(dl))}
        ${row("SLA vùng", s.slaH ? s.slaH + "h" : "")}
        ${row("Địa chỉ", E(s.addr || prof.addr))}
      </div>
      <div class="ws-sub">${fixH}</div>
      <div class="ws-sub">${notesH}</div>`;
  }

  // ---------------- Tab 2: Lịch sử ----------------
  let histFilter = { days: 0, sameError: "", withParts: false };
  function historyHtml() {
    const s = P().getTicketSummary(ws.ticketId);
    const f = { ...histFilter };
    if (histFilter.sameErrorOn && s) f.sameError = (s.err || "").split(" ")[0];
    const h = P().getStationHistory(ws.code, f);
    if (!h.loaded) return `<div class="ws-skel">Đang tải lịch sử từ CCTS…</div>`;
    if (h.error) return `<div class="ws-empty">Lỗi tải lịch sử (mạng/quyền).<br>
      <button class="ws-btn" data-hist-retry="1" style="margin-top:8px">↻ Thử lại</button></div>`;
    const chips = `
      <div class="ws-chips">
        ${[["Tất cả", 0], ["7 ngày", 7], ["30 ngày", 30], ["90 ngày", 90]].map(([l, d]) =>
          `<button class="chip${histFilter.days === d ? " on" : ""}" data-days="${d}">${l}</button>`).join("")}
        <button class="chip${histFilter.sameErrorOn ? " on" : ""}" data-same="1">Cùng Error Code</button>
        <button class="chip${histFilter.withParts ? " on" : ""}" data-parts="1">Có thay vật tư</button>
      </div>`;
    const ai = h.ai ? `<div class="ws-ai">✨ <b>Tóm tắt AI</b><br>${E(h.ai)}</div>` : "";
    if (!h.events.length) return chips + ai + `<div class="ws-empty">Chưa có dữ liệu lịch sử từ CCTS cho bộ lọc này.</div>`;
    const kindLabel = { event: "Tác động", solution: "Giải pháp", part: "Vật tư" };
    const rows = h.events.slice(0, 60).map((e) => `
      <div class="ws-ev ${e.kind}">
        <div class="ws-ev-h"><span>${e.ts ? new Date(e.ts).toLocaleString("vi") : "?"}</span>
          <span class="ws-ev-k">${kindLabel[e.kind] || e.kind}</span></div>
        <div><b>${E(e.actor || "?")}</b> · <span class="muted">${E(e.ticketId)}</span></div>
        <div>${E(e.content || "—")}</div>
        <div class="ws-src">nguồn: ${E(e.source)}</div>
      </div>`).join("");
    return chips + ai + `<div class="ws-note-src">Hiển thị ${h.tickets.length} ticket · ${h.events.length} sự kiện tại ${E(ws.code)}</div>` + rows;
  }

  // ---------------- Tab 3: Vật tư ----------------
  function partsHtml() {
    const parts = P().getStationParts(ws.code);
    if (!parts.length) return `<div class="ws-empty">Chưa có dữ liệu vật tư từ CCTS (cập nhật theo export hằng ngày).</div>`;
    const alerts = P().partAlerts(parts);
    const al = alerts.length ? `<div class="ws-alerts">${alerts.map((a) =>
      `<div class="ws-alert ${a.level}">${a.level === "warning" ? "⚠" : "ℹ"} ${E(a.message)}</div>`).join("")}</div>` : "";
    const grp = (title, list, cls) => list.length ? `<div class="ws-psec"><div class="ws-psec-h ${cls}">${title} (${list.length})</div>${
      list.map((p) => `<div class="ws-part">
        <b>${E(p.materialName || p.materialCode)}</b> ${p.quantity ? "×" + E(p.quantity) : ""}
        ${p.isReusedPart ? '<span class="ws-badge rp">-RP tái sử dụng</span>' : ""}
        ${p.isPCBA ? '<span class="ws-badge pcba">PCBA</span>' : ""}
        <div class="muted">${E(p.materialCode)}${p.serialNumber ? " · SN " + E(p.serialNumber) : (p.isReusedPart ? " · <span style='color:#dc2626'>thiếu SN</span>" : "")}</div>
        <div class="muted">${p.replacedBy ? "👷 " + E(p.replacedBy) : ""} ${p.replacedAt ? "· " + new Date(+p.replacedAt).toLocaleDateString("vi") : ""} · ${E(p.ticketId)}</div>
        ${p.notes ? `<div class="ws-src">${E(p.notes)}</div>` : ""}
      </div>`).join("")}</div>` : "";
    return al
      + grp("🟢 Vật tư tốt đã lắp", parts.filter((p) => p.partType === "good"), "good")
      + grp("🔴 Vật tư hỏng tháo về", parts.filter((p) => p.partType === "broken"), "broken")
      + grp("♻️ Khác / chưa rõ loại", parts.filter((p) => p.partType === "unknown"), "unk");
  }

  // ---------------- body wiring (copy, ccts) ----------------
  function wireBody() {
    document.querySelectorAll("#ws [data-copy]").forEach((b) => b.onclick = () => {
      navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy);
      if (typeof toast === "function") toast("Đã copy: " + b.dataset.copy);
    });
    if ($("ws-ccts")) $("ws-ccts").onclick = () => {
      const url = CCTS_URL(ws.ticketId);
      if (url) global.open(url, "_blank"); else toast && toast("Chưa cấu hình URL CCTS (CCTS_TICKET_URL)");
    };
    document.querySelectorAll("#ws [data-hist-retry]").forEach((b) => b.onclick = () => {
      if (typeof retryStationHistory === "function") retryStationHistory(ws.code);
      $("ws-body").innerHTML = `<div class="ws-skel">Đang tải lịch sử từ CCTS…</div>`;
    });
    document.querySelectorAll("#ws .chip").forEach((c) => c.onclick = () => {
      if (c.dataset.days != null) histFilter.days = +c.dataset.days;
      if (c.dataset.same) histFilter.sameErrorOn = !histFilter.sameErrorOn;
      if (c.dataset.parts) histFilter.withParts = !histFilter.withParts;
      $("ws-body").innerHTML = historyHtml(); wireBody();
    });
  }

  // Cho app.js gọi lại khi lịch sử/notes vừa nạp xong để làm tươi tab đang mở.
  // KHÔNG đụng tab Copilot (giữ nguyên phiên hỏi-đáp/checklist người dùng đang thao tác).
  function refresh() {
    if (!($("ws-root") && $("ws-root").classList.contains("show") && ws.code)) return;
    if (ws.tab === "copilot") { renderHead(); return; }
    renderBody();
  }

  // ---------------- Copilot UI ----------------
  const copilotShell = () => `<div id="cop">${Copilot.shellHtml()}</div>`;

  const Copilot = {
    session: { answers: {}, checklist: {} },
    controller: null,
    shellHtml() {
      const on = !!COPILOT_URL();
      const acts = [["analyze", "🔍 Phân tích ticket"], ["checklist", "✅ Checklist onsite"],
        ["log", "📄 Phân tích log"], ["pre_part", "🔧 Trước khi thay part"],
        ["evidence", "📷 Bằng chứng cần chụp"], ["escalation", "⬆ Tóm tắt escalation"]];
      return `
        ${on ? "" : '<div class="ws-alert warning">⚠ Copilot chưa cấu hình (COPILOT_API_URL trống). Backend chạy riêng, xem SECURITY_NOTES.</div>'}
        <div class="cop-acts">${acts.map(([m, l]) => `<button class="cop-act" data-mode="${m}" ${on ? "" : "disabled"}>${l}</button>`).join("")}</div>
        <div class="cop-input">
          <textarea id="cop-q" placeholder="Hỏi tự do (vd: đo continuity slot 5 ra 0.2V, có bình thường không?)" ${on ? "" : "disabled"}></textarea>
          <div class="cop-io-row">
            <button id="cop-send" ${on ? "" : "disabled"}>Gửi</button>
            <button id="cop-stop" class="ghost" style="display:none">■ Dừng</button>
          </div>
        </div>
        <div id="cop-out"></div>`;
    },
    bind() {
      document.querySelectorAll("#cop .cop-act").forEach((b) => b.onclick = () => this.run(b.dataset.mode));
      const send = $("cop-send"); if (send) send.onclick = () => this.run("free");
      const stop = $("cop-stop"); if (stop) stop.onclick = () => { if (this.controller) this.controller.abort(); };
    },
    buildRequest(mode) {
      const s = P().getTicketSummary(ws.ticketId) || {};
      const hist = P().getStationHistory(ws.code, {});
      return {
        ticketId: s.id || "", stationCode: ws.code || "", model: s.model || "",
        bom: s.bom || "", firmware: s.firmware || "",
        errorCodes: s.err ? [String(s.err).split(" ")[0]] : [],
        ticketSummary: { name: s.name, status: s.status, owner: s.owner },
        timeline: (hist.events || []).slice(0, 12),
        parts: P().getStationParts(ws.code).slice(0, 12),
        stationNotes: typeof notesOf === "function" ? notesOf(ws.code).map((n) => n.text) : [],
        userObservations: [], measurements: this.session.measurements || [],
        userQuestion: mode === "free" ? ($("cop-q") ? $("cop-q").value.trim() : "") : "",
        mode: mode, logText: this.session.logText || "",
      };
    },
    async run(mode) {
      const url = COPILOT_URL();
      if (!url) return;
      const out = $("cop-out");
      out.innerHTML = this.skeleton();
      $("cop-stop").style.display = ""; $("cop-send").disabled = true;
      this.controller = new AbortController();
      const to = setTimeout(() => this.controller.abort(), 60000);
      try {
        const res = await fetch(url.replace(/\/$/, "") + "/api/copilot/query", {
          method: "POST", headers: { "Content-Type": "application/json",
            ...(COPILOT_TOK() ? { Authorization: "Bearer " + COPILOT_TOK() } : {}) },
          body: JSON.stringify(this.buildRequest(mode)), signal: this.controller.signal,
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        out.innerHTML = this.render(data);
        this.wireAnswer(data);
      } catch (e) {
        out.innerHTML = `<div class="ws-alert warning">Không lấy được câu trả lời (${E(e.message)}).
          <button id="cop-retry" class="ws-btn">Thử lại</button></div>`;
        const r = $("cop-retry"); if (r) r.onclick = () => this.run(mode);
      } finally {
        clearTimeout(to); this.controller = null;
        $("cop-stop").style.display = "none"; $("cop-send").disabled = false;
      }
    },
    skeleton() { return `<div class="cop-sk"><div></div><div></div><div></div><div class="s2"></div><div></div></div>`; },
    render(d) {
      const cs = d.contextSummary || {};
      const chip = (c) => `<button class="cop-cite" data-url="${E(c.driveUrl || "")}" title="${E(c.section || c.title)}">[${c.n}] ${E((c.title || "").slice(0, 26))}${c.modelMismatch ? " ⚠khác model" : ""}</button>`;
      const conf = { "Cao": "hi", "Trung bình": "mid", "Thấp": "lo" };
      const secB = d.degraded ? '<span class="cop-degraded">bản rút gọn (LLM tắt)</span>' : "";
      return `
        ${(d.safetyWarnings || []).map((w) => `<div class="ws-alert warning">${E(w)}</div>`).join("")}
        <div class="cop-sec"><h4>A. Bối cảnh ${secB}</h4>
          <div class="muted">Thiết bị: ${E(cs.device || "?")} · Model: ${E(cs.model || "?")} · Lỗi: ${E((cs.errorCodes || []).join(", "))}</div>
          ${cs.note ? `<div class="muted">${E(cs.note)}</div>` : ""}
          ${(d.missingData || []).length ? `<div class="cop-miss">Còn thiếu: ${(d.missingData).map(E).join(" · ")}</div>` : ""}</div>
        ${(d.hypotheses || []).length ? `<div class="cop-sec"><h4>B. Nguyên nhân khả dĩ</h4>${
          d.hypotheses.map((h) => `<div class="cop-hyp"><span class="cop-conf ${conf[h.confidence] || "lo"}">${E(h.confidence)}</span>
            <b>${E(h.cause)}</b> <span class="cop-kind">${E(h.kind || "")}</span>
            ${(h.support || []).map((x) => `<div class="cop-ev sup">+ ${E(x)}</div>`).join("")}
            ${(h.contradict || []).map((x) => `<div class="cop-ev con">− ${E(x)}</div>`).join("")}</div>`).join("")}</div>` : ""}
        ${(d.checklist || []).length ? `<div class="cop-sec"><h4>C. Checklist kiểm tra</h4><div id="cop-cl">${
          d.checklist.map((st, i) => this.stepHtml(st, i)).join("")}</div>
          <button id="cop-next" class="ws-btn">Đề xuất bước tiếp theo dựa trên kết quả</button></div>` : ""}
        ${(d.partsAdvice || []).length ? `<div class="cop-sec"><h4>D. Khuyến nghị vật tư</h4>${
          d.partsAdvice.map((p) => `<div class="cop-part"><b>${E(p.part)}</b>
            ${p.verifyBefore ? `<div>Xác minh trước: ${E(p.verifyBefore)}</div>` : ""}
            ${p.doNotRepeat ? `<div class="con">${E(p.doNotRepeat)}</div>` : ""}
            ${p.note ? `<div class="muted">${E(p.note)}</div>` : ""}</div>`).join("")}</div>` : ""}
        ${(d.evidenceRequired || []).length ? `<div class="cop-sec"><h4>Bằng chứng cần thu thập</h4>${
          d.evidenceRequired.map((e) => `<div>📷 <b>${E(e.what)}</b> ${e.why ? `<span class="muted">— ${E(e.why)}</span>` : ""}</div>`).join("")}</div>` : ""}
        ${(d.escalationConditions || []).length ? `<div class="cop-sec"><h4>E. Điều kiện escalation</h4>${
          d.escalationConditions.map((x) => `<div>⬆ ${E(x)}</div>`).join("")}</div>` : ""}
        ${(d.citations || []).length ? `<div class="cop-sec"><h4>F. Nguồn</h4><div class="cop-cites">${
          d.citations.map(chip).join("")}</div></div>` : `<div class="cop-sec muted">Không có nguồn tài liệu — nội dung là suy luận, cần CSE xác nhận.</div>`}
        ${(d.followupQuestions || []).length ? `<div class="cop-sec"><h4>Câu hỏi bổ sung</h4>${
          d.followupQuestions.map((q) => `<div>❓ ${E(q)}</div>`).join("")}</div>` : ""}`;
    },
    stepHtml(st, i) {
      const id = "cl" + i;
      const opts = [["", "Chưa"], ["pass", "Đạt"], ["fail", "Không đạt"], ["na", "N/A"]];
      const cur = this.session.checklist[id] || "";
      return `<div class="cop-step" data-id="${id}">
        <div class="cop-step-h"><b>${st.step || i + 1}. ${E(st.action)}</b></div>
        <div class="muted">${st.tool ? "🛠 " + E(st.tool) + " · " : ""}${st.location ? "📍 " + E(st.location) : ""}</div>
        ${st.expected ? `<div>Kỳ vọng: <b>${E(st.expected)}</b></div>` : ""}
        <div class="cop-step-st">${opts.map(([v, l]) => `<button class="cop-st-b${cur === v ? " on" : ""}" data-v="${v}">${l}</button>`).join("")}</div>
        <div class="cop-branch">${st.ifPass ? `<div class="sup">Đạt → ${E(st.ifPass)}</div>` : ""}${st.ifFail ? `<div class="con">Không đạt → ${E(st.ifFail)}</div>` : ""}</div>
        ${(st.evidence || []).length ? `<div class="muted">📷 ${st.evidence.map(E).join(", ")}</div>` : ""}
        <input class="cop-meas" placeholder="Giá trị đo / ghi chú bước này…" value="${E((this.session.answers[id] || ""))}">
      </div>`;
    },
    wireAnswer(d) {
      document.querySelectorAll("#cop .cop-cite").forEach((b) => b.onclick = () => {
        if (b.dataset.url) global.open(b.dataset.url, "_blank", "noopener");
        else toast && toast("Nguồn không có link Drive công khai");
      });
      document.querySelectorAll("#cop .cop-step").forEach((step) => {
        const id = step.dataset.id;
        step.querySelectorAll(".cop-st-b").forEach((b) => b.onclick = () => {
          this.session.checklist[id] = b.dataset.v;
          step.querySelectorAll(".cop-st-b").forEach((x) => x.classList.toggle("on", x === b));
        });
        const inp = step.querySelector(".cop-meas");
        if (inp) inp.oninput = () => { this.session.answers[id] = inp.value; };
      });
      const next = $("cop-next");
      if (next) next.onclick = () => {
        // dùng kết quả bước trước làm measurements/observations cho lần hỏi tiếp
        this.session.measurements = Object.entries(this.session.answers).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
        const fails = Object.entries(this.session.checklist).filter(([, v]) => v === "fail").map(([k]) => k);
        this.session.logText = (this.session.logText || "") + (fails.length ? " | Bước không đạt: " + fails.join(",") : "");
        this.run("analyze");
      };
    },
  };

  global.Workspace = { open, close, refresh };
})(window);
