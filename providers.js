/* ============================================================================
 * providers.js — Data-provider contract cho Ticket Workspace / Station 360°.
 *
 * UI KHÔNG đọc trực tiếp tên cột Excel/Firebase. Mọi thứ đi qua domain model ở
 * đây. Nguồn hiện tại: dữ liệu live trong app.js (tickets, stHist=/dashboard/stations,
 * notes, rejLive, stOverrides). Sau này thay bằng API sla_monitor mà không đổi UI.
 *
 * Domain model:
 *   TicketSummary   {id,name,stationCode,cpid,status,rej,slaH,deadline,createMs,
 *                    owner,collab,err,urgency,addr,model,bom,firmware}
 *   StationProfile  {code,type,name,addr,pos,noteCount,hasFix}
 *   TicketEvent     {ts,ticketId,actor,kind,content,source}
 *   SparePartRecord {ticketId,stationCode,materialCode,materialName,partType,
 *                    isReusedPart,serialNumber,quantity,replacedBy,replacedAt,notes,
 *                    replacementResult,isPCBA,source}
 * ==========================================================================*/
(function (global) {
  "use strict";

  // ---- helpers dùng lại từ app.js (đã là global) ----
  const nk = (c) => (typeof noteKey === "function" ? noteKey(c) : String(c).replace(/[.#$/\[\]]/g, "_"));
  // app.js/libs khai báo bằng let/const -> là GLOBAL LEXICAL, KHÔNG phải window.*;
  // đọc qua accessor có guard để tránh ReferenceError và undefined.
  const TICKETS = () => (typeof tickets !== "undefined" && tickets ? tickets : []);
  const STHIST = () => (typeof stHist !== "undefined" && stHist ? stHist : {});
  const STATIONS_G = () => (typeof STATIONS !== "undefined" && STATIONS ? STATIONS : {});

  // ---------- TicketSummary ----------
  function ticketToSummary(t) {
    if (!t) return null;
    return {
      id: t.id || "",
      name: t.name || "",
      stationCode: t.stRaw || t.st || "",
      mappedStation: t.st || null,
      cpid: t.cpid || "",
      status: t.status || "",
      rej: typeof isRej === "function" ? isRej(t) : !!t.rej,
      slaH: t.limitH,
      deadline: t.deadline,
      createMs: t.createT,
      owner: t.owner || "",
      collab: t.collab || "",
      err: t.err || "",
      urgency: t.urg || "",
      addr: t.addr || "",
      // Model/BOM/FW: KHÔNG suy đoán từ tài liệu — chỉ từ dữ liệu live nếu có.
      model: t.model || "",
      bom: t.bom || "",
      firmware: t.firmware || "",
    };
  }

  function getTicketSummary(ticketId) {
    const t = TICKETS().find((x) => x.id === ticketId);
    return ticketToSummary(t);
  }

  function getStationTicketsOpen(stationCode) {
    // ticket ĐANG MỞ tại trạm (từ /tickets/current đã lọc HN)
    return TICKETS()
      .filter((t) => (t.st || t.stRaw) === stationCode || t.st === stationCode)
      .map(ticketToSummary)
      .sort((a, b) => (a.deadline || 0) - (b.deadline || 0));
  }

  function getTicketDetail(ticketId) {
    const s = getTicketSummary(ticketId);
    if (!s) return null;
    return { ...s, events: getTicketEvents(ticketId), parts: getTicketParts(ticketId) };
  }

  // ---------- StationProfile ----------
  function getStationProfile(stationCode) {
    const S = STATIONS_G()[stationCode];
    const pos = typeof stationPos === "function" ? stationPos(stationCode) : (S ? [S[0], S[1]] : null);
    return {
      code: stationCode,
      type: S ? (S[2] === "B" ? "BSS" : "EVCS") : "",
      name: S ? S[3] : "",
      addr: S ? (S[4] || "") : "",
      pos: pos,
      noteCount: typeof notesOf === "function" ? notesOf(stationCode).length : 0,
      hasFix: typeof pendingFix === "function" ? !!pendingFix(stationCode) : false,
    };
  }

  // ---------- Lịch sử: /dashboard/stations/<key> (đã build từ export) ----------
  function _stationRec(stationCode) {
    return STHIST()[nk(stationCode)] || null;
  }

  // Lịch sử tác động = phần Solution (+ Vật tư) của các ticket tại trạm.
  // KHÔNG dùng Events Record (chỉ là nhật ký đổi trạng thái, không phải thao tác sửa) — chốt 22/07/2026.
  function _recEvents(rec, opts) {
    if (!rec || !rec.tickets) return [];
    const evs = [];
    for (const t of rec.tickets) {
      for (const s of (t.sol || [])) {
        if (s.desc) evs.push({ ts: t.createMs, ticketId: t.id, actor: s.proc || "",
          kind: "solution", content: s.desc, source: "CCTS Solutions" });
      }
      for (const p of (t.parts || [])) {
        if (p.mname) evs.push({ ts: t.createMs, ticketId: t.id, actor: p.proc || "",
          kind: "part", content: "Thay: " + p.mname + (p.qty ? " ×" + p.qty : ""), source: "CCTS Spare Parts" });
      }
    }
    return evs.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }

  function getTicketEvents(ticketId) {
    // gom event của đúng ticketId từ mọi trạm đã nạp (thường trạm đang mở)
    for (const key in STHIST()) {
      const rec = STHIST()[key];
      if (rec && rec.tickets && rec.tickets.some((t) => t.id === ticketId)) {
        return _recEvents(rec, {}).filter((e) => e.ticketId === ticketId);
      }
    }
    return [];
  }

  // filters: {days:7|30|90, sameError:'B6029', withParts:true}
  function getStationHistory(stationCode, filters) {
    filters = filters || {};
    const raw = STHIST()[nk(stationCode)];
    if (raw === undefined) return { loaded: false, tickets: [], events: [], ai: null };
    if (raw && raw.failed) return { loaded: true, error: true, tickets: [], events: [], ai: null };
    const rec = raw;
    if (rec === null) return { loaded: true, tickets: [], events: [], ai: null };
    let tickets = (rec.tickets || []).slice();
    if (filters.days) {
      const cut = Date.now() - filters.days * 86400000;
      tickets = tickets.filter((t) => (t.createMs || 0) >= cut);
    }
    if (filters.sameError) tickets = tickets.filter((t) => (t.err || "").includes(filters.sameError));
    if (filters.withParts) tickets = tickets.filter((t) => (t.parts || []).length);
    return { loaded: true, ai: rec.ai || null, tickets,
      events: _recEvents({ tickets }, filters) };
  }

  // ---------- Vật tư (chuẩn hóa client-side, khớp spare_parts.py backend) ----------
  const SN_RE = /\bSN\d{5}\b/i;
  function normPart(p, ticketId, stationCode) {
    const code = String(p.materialCode || p.mcode || "").trim();
    const note = String(p.notes || p.note || "").trim();
    const mtype = String(p.materialType || p.mtype || p.partType || "").toLowerCase();
    const sn = note.match(SN_RE);
    let partType = "unknown";
    if (mtype.includes("good")) partType = "good";
    else if (mtype.includes("broken")) partType = "broken";
    else if (p.partType) partType = p.partType;
    return {
      ticketId: ticketId || p.ticketId || "",
      stationCode: stationCode || p.stationCode || "",
      materialCode: code,
      materialName: String(p.materialName || p.mname || "").trim(),
      partType: partType,
      isReusedPart: code.toUpperCase().endsWith("-RP"),
      serialNumber: sn ? sn[0].toUpperCase() : "",
      quantity: p.quantity != null ? p.quantity : (p.qty != null ? p.qty : null),
      replacedBy: String(p.replacedBy || p.proc || "").trim(),
      replacedAt: p.replacedAt || p.createMs || null,
      notes: note,
      isPCBA: /\b(PCBA|board|mạch|BCC)\b/i.test(code + " " + (p.materialName || p.mname || "")),
      source: "CCTS Spare Parts Record",
    };
  }

  function getStationParts(stationCode) {
    const rec = _stationRec(stationCode);
    if (!rec || !rec.tickets) return [];
    const out = [];
    for (const t of rec.tickets)
      for (const p of (t.parts || []))
        out.push(normPart({ mname: p.mname, qty: p.qty, proc: p.proc, materialCode: p.mcode, note: p.note, mtype: p.mtype }, t.id, stationCode));
    return out;
  }
  function getTicketParts(ticketId) {
    for (const key in STHIST()) {
      const rec = STHIST()[key];
      const t = rec && rec.tickets && rec.tickets.find((x) => x.id === ticketId);
      if (t) return (t.parts || []).map((p) => normPart({ mname: p.mname, qty: p.qty, proc: p.proc, materialCode: p.mcode, note: p.note, mtype: p.mtype }, ticketId, rec.code));
    }
    return [];
  }

  // ---------- Cảnh báo vật tư có căn cứ (khớp spare_parts.alerts) ----------
  function partAlerts(parts) {
    const out = [];
    const byCode = {};
    parts.forEach((p) => { if (p.materialCode) (byCode[p.materialCode.toUpperCase().replace("-RP", "")] ||= []).push(p); });
    for (const code in byCode) {
      const ts = byCode[code].map((p) => +p.replacedAt).filter(Boolean).sort((a, b) => a - b);
      if (ts.length >= 2 && ts[ts.length - 1] - ts[0] <= 30 * 86400000)
        out.push({ level: "warning", type: "repeat_part", message: `Part ${code} đã thay ${ts.length} lần trong ≤30 ngày — cần đo lại nguyên nhân, không thay lặp.` });
    }
    parts.forEach((p) => {
      if (p.isReusedPart && !p.serialNumber)
        out.push({ level: "warning", type: "reused_no_serial", message: `Part tái sử dụng ${p.materialCode} thiếu Serial (SN+5 số).` });
    });
    const byTicket = {};
    parts.forEach((p) => (byTicket[p.ticketId] ||= []).push(p));
    for (const tid in byTicket) {
      const ps = byTicket[tid];
      const goods = new Set(ps.filter((p) => p.partType === "good" && p.materialCode).map((p) => p.materialCode.toUpperCase().replace("-RP", "")));
      const broken = new Set(ps.filter((p) => p.partType === "broken" && p.materialCode).map((p) => p.materialCode.toUpperCase().replace("-RP", "")));
      const miss = [...goods].filter((c) => !broken.has(c));
      if (miss.length) out.push({ level: "info", type: "good_without_broken", message: `Ticket ${tid}: có Good part nhưng thiếu Broken part tương ứng (${miss.join(", ")}).` });
      if (ps.some((p) => p.isPCBA)) out.push({ level: "info", type: "pcba_process", message: `Ticket ${tid}: có thay PCBA/board — kiểm tra ảnh good/broken, ID/label & Problem Analysis.` });
    }
    return out;
  }

  global.Providers = {
    getTicketSummary, getTicketDetail, getStationProfile, getStationTicketsOpen,
    getStationHistory, getTicketEvents, getTicketParts, getStationParts, partAlerts,
  };
})(window);
