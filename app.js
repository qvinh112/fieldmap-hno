/* CCTS Field Map — HNO
   Import Tickets.xlsx từ CCTS -> bản đồ trạm + SLA còn lại + vị trí SE real-time.
   Chế độ: có FIREBASE_CONFIG = đồng bộ cả đội (real-time); null = offline một máy. */

"use strict";
const $ = (id) => document.getElementById(id);
const HOURS = 3600e3;

// ---------- tiện ích ----------
function toDate(v) {
  if (v == null || v === "" || v === "----") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number") { // serial Excel
    const d = new Date(Math.round((v - 25569) * 864e5));
    return isNaN(d) ? null : d;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
// tách chuỗi nhiều tên "a; b, c" -> ["a","b","c"]
function tokens(s) { return String(s || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean); }
function distKm(a, b, c, d) { // haversine
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
  return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
}
function toast(msg, ms) {
  const t = $("toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(toast._h); toast._h = setTimeout(() => (t.style.display = "none"), ms || 3200);
}

// tra trạm: thử mã gốc rồi biến thể bỏ số 0 đệm (B.HNO01031 <-> B.HNO1031)
const ST_NORM = {};
for (const k in STATIONS) {
  const m = k.match(/^([A-Z])\.([A-Z]+)0*(\d+)$/);
  if (m) ST_NORM[m[1] + "." + m[2] + +m[3]] = k;
}
function stationOf(code) {
  const s = String(code || "").trim().toUpperCase();
  if (STATIONS[s]) return s;
  const m = s.match(/^([A-Z])\.([A-Z]+)0*(\d+)$/);
  return (m && ST_NORM[m[1] + "." + m[2] + +m[3]]) || null;
}
// vùng SLA nhanh (station_map.js của dashboard, chỉ trạm sạc C.HNO Tự doanh)
const ZONE_NORM = {};
for (const k in STATION_MAP) {
  const m = k.match(/^C\.([A-Z]+)0*(\d+)$/);
  if (m) ZONE_NORM["C." + m[1] + +m[2]] = STATION_MAP[k];
}
function zoneOf(code) {
  const s = String(code || "").trim().toUpperCase();
  const v = STATION_MAP[s] || (function () { const m = s.match(/^C\.([A-Z]+)0*(\d+)$/); return m ? ZONE_NORM["C." + m[1] + +m[2]] : null; })();
  return v ? v[0] : null;
}

// ---------- màu SLA còn lại ----------
const BUCKETS = [
  ["over", "Quá hạn", "#7f1d1d"],
  ["b1", "0–1 giờ", "#dc2626"],
  ["b3", "1–3 giờ", "#f97316"],
  ["b8", "3–8 giờ", "#eab308"],
  ["b24", "8–24 giờ", "#84cc16"],
  ["b99", "> 24 giờ", "#16a34a"],
];
const BCOLOR = Object.fromEntries(BUCKETS.map((b) => [b[0], b[2]]));
function bucketOf(t) {
  const h = (t.deadline - Date.now()) / HOURS;
  return h < 0 ? "over" : h <= 1 ? "b1" : h <= 3 ? "b3" : h <= 8 ? "b8" : h <= 24 ? "b24" : "b99";
}
function remText(t) {
  let ms = t.deadline - Date.now();
  const over = ms < 0; ms = Math.abs(ms);
  const h = Math.floor(ms / HOURS), m = Math.floor((ms % HOURS) / 60000);
  const s = h >= 48 ? Math.round(h / 24) + " ngày" : h + "h" + String(m).padStart(2, "0");
  return over ? "quá " + s : "còn " + s;
}

// ---------- trạng thái ----------
let user = null;             // {name, role}
let tickets = [];            // ticket mở khu vực HN sau import
let meta = null;             // {file, at, by}
let myPos = null;            // [lat, lng]
let presence = {};           // uid -> {name, role, lat, lng, ts}
let notes = {};              // safeKey(mã trạm) -> { pushId: {type:'addr'|'site', text, by, ts} }
let openStation = null;      // mã trạm đang mở popup (để cập nhật khi note đổi)
let db = null, myUid = null;
const map = L.map("map", { zoomControl: false, preferCanvas: true }).setView([21.02, 105.84], 11);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
L.control.zoom({ position: "bottomleft" }).addTo(map);
const tkLayer = L.layerGroup().addTo(map);
const seLayer = L.layerGroup().addTo(map);
let myMarker = null;

// chú giải
const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const d = L.DomUtil.create("div", "legend");
  d.innerHTML = '<div class="legend-hd">SLA còn lại <span class="legend-caret">▾</span></div><div class="legend-body">' +
    BUCKETS.slice().reverse().map((b) => '<span class="dot" style="background:' + b[2] + '"></span>' + b[1]).join("<br>") +
    '<br><span class="dot" style="background:#0ea5e9"></span>SE online' +
    '<br><span class="dot" style="background:#f59e0b"></span>Chậm cập nhật' +
    '<br><span class="dot" style="background:#fff;border:2px solid #f59e0b"></span>Trạm có ghi chú</div>';
  L.DomEvent.disableClickPropagation(d);
  d.querySelector(".legend-hd").onclick = () => d.classList.toggle("expanded"); // mobile: mở/gọn (desktop CSS luôn mở)
  return d;
};
legend.addTo(map);

// nút "vị trí tôi"
const locBtn = L.control({ position: "bottomleft" });
locBtn.onAdd = () => {
  const d = L.DomUtil.create("div", "leaflet-bar");
  d.innerHTML = '<a href="#" title="Về vị trí tôi" style="font-size:15px">⌖</a>';
  d.onclick = (e) => { e.preventDefault(); if (myPos) map.setView(myPos, 14); else toast("Chưa lấy được GPS — kiểm tra quyền vị trí"); };
  return d;
};
locBtn.addTo(map);

// ---------- đăng nhập ----------
$("in_role").addEventListener("change", () => { $("adminrow").style.display = $("in_role").value === "ADMIN" ? "block" : "none"; });
$("mode_hint").textContent = FIREBASE_CONFIG
  ? "Chế độ ĐỘI: vị trí và dữ liệu import chia sẻ real-time cho mọi người."
  : "Chế độ OFFLINE: chưa cấu hình Firebase (config.js) — dữ liệu chỉ trên máy này.";

$("btn_login").addEventListener("click", () => {
  const name = $("in_name").value.trim();
  if (!name) return toast("Nhập tên hiển thị");
  const role = $("in_role").value;
  if (role === "ADMIN" && $("in_code").value !== ADMIN_CODE) return toast("Sai mã admin");
  user = { name: name, role: role };
  localStorage.setItem("fm_user", JSON.stringify(user));
  enter();
});
$("whoami").addEventListener("click", () => {
  if (!confirm("Đăng xuất?")) return;
  localStorage.removeItem("fm_user");
  if (db && myUid) db.ref("presence/" + myUid).remove();
  location.reload();
});

function enter() {
  $("login").style.display = "none";
  $("whoami").innerHTML = "<b>" + esc(user.name) + "</b><br><span style='color:#64748b'>" + user.role + " · chạm để đăng xuất</span>";
  if (user.role === "ADMIN") $("btn_import").style.display = "";
  startGeo();
  if (FIREBASE_CONFIG) startFirebase();
  else { // offline: nạp lại lần import trước + ghi chú trên máy này
    try {
      const c = JSON.parse(localStorage.getItem("fm_tickets") || "null");
      if (c) { tickets = c.rows; meta = c.meta; afterData(); }
      notes = JSON.parse(localStorage.getItem("fm_notes") || "{}");
    } catch (e) {}
  }
  render();
}

// ---------- Firebase (chế độ đội) ----------
function startFirebase() {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.database();
  firebase.auth().signInAnonymously().then((cred) => {
    myUid = cred.user.uid;
    pushPresence(true);
    db.ref("presence/" + myUid).onDisconnect().remove();
    // listener phải gắn SAU khi auth xong: gắn trước bị rules từ chối và Firebase hủy luôn, không tự gắn lại
    db.ref("tickets/current").on("value", (snap) => {
      const v = snap.val();
      if (v && v.rows) { tickets = v.rows; meta = v.meta; afterData(); render(); }
    }, (e) => toast("Không đọc được dữ liệu ticket: " + e.message, 6000));
    db.ref("presence").on("value", (snap) => {
      presence = snap.val() || {};
      renderSE(); renderOnline();
    }, () => {});
    db.ref("notes").on("value", (snap) => {
      notes = snap.val() || {};
      render();
    }, () => {});
  }).catch((e) => toast("Firebase auth lỗi: " + e.message, 6000));
}
let lastSent = 0, lastSentPos = null;
function pushPresence(force) {
  if (!db || !myUid || !myPos || !user) return;
  const now = Date.now();
  const moved = !lastSentPos || distKm(myPos[0], myPos[1], lastSentPos[0], lastSentPos[1]) > 0.1;
  if (!force && !moved && now - lastSent < HEARTBEAT_S * 1000) return;
  lastSent = now; lastSentPos = myPos.slice();
  db.ref("presence/" + myUid).set({ name: user.name, role: user.role, lat: myPos[0], lng: myPos[1], ts: now });
}

// ---------- GPS của tôi ----------
let lastRenderPos = null;
function startGeo() {
  if (!navigator.geolocation) return toast("Trình duyệt không hỗ trợ GPS");
  navigator.geolocation.watchPosition((p) => {
    const first = !myPos;
    myPos = [p.coords.latitude, p.coords.longitude];
    if (!myMarker) {
      myMarker = L.circleMarker(myPos, { radius: 8, color: "#fff", weight: 2.5, fillColor: "#2563eb", fillOpacity: 1 })
        .addTo(map).bindPopup("Vị trí của bạn");
    } else myMarker.setLatLng(myPos);
    if (first) map.setView(myPos, 13);
    pushPresence(false);
    // chỉ vẽ lại khi di chuyển >30m — tránh rung GPS làm đóng/mở popup liên tục lúc SE đang gõ note
    if (first || !lastRenderPos || distKm(myPos[0], myPos[1], lastRenderPos[0], lastRenderPos[1]) > 0.03) {
      lastRenderPos = myPos.slice();
      render();
    }
  }, () => {}, { enableHighAccuracy: true, maximumAge: 15000 });
}

// ---------- import Excel ----------
$("btn_import").addEventListener("click", () => $("fileinput").click());
$("fileinput").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  toast("Đang đọc " + f.name + "…", 60000);
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets["Ticket Information"] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    // ticket có ghi nhận vật tư -> SLA V2/V3 nới (7h/12h) theo rule 02/07/2026
    const partsIds = new Set();
    if (wb.Sheets["Spare Parts Record"]) {
      for (const r of XLSX.utils.sheet_to_json(wb.Sheets["Spare Parts Record"], { defval: null }))
        if (r["Ticket ID"]) partsIds.add(String(r["Ticket ID"]).trim());
    }
    ingest(rows, partsIds, f.name);
  } catch (err) { toast("Lỗi đọc file: " + err.message, 6000); }
});

function ingest(rows, partsIds, fname) {
  const out = []; let nHN = 0;
  for (const r of rows) {
    const id = String(r["Ticket ID"] || "").trim();
    if (!id || id === "Ticket ID") continue;
    const status = String(r["Ticket Status"] || "");
    if (/closed|cancel/i.test(status)) continue; // field map chỉ quan tâm ticket đang mở
    const stRaw = String(r["Station Code"] || "").trim();
    const stKey = stationOf(stRaw);
    const addr = String(r["Address"] || "");
    if (!stKey && !/hà nội|ha noi|hanoi/i.test(addr)) continue; // ngoài HNO
    nHN++;
    const createT = toDate(r["Create Time"]);
    if (!createT) continue;
    // hạn xử lý: V1=3h; V2=4h (có vật tư 7h); V3=7h (có vật tư 12h); còn lại 48h
    // (SLA nhanh chỉ áp cho nguồn API creation — rule 07/07/2026)
    const zone = /api/i.test(String(r["Ticket Source"] || "")) ? zoneOf(stRaw) : null;
    const hasParts = partsIds.has(id);
    let limitH = 48;
    if (zone === "V1") limitH = 3;
    else if (zone === "V2") limitH = hasParts ? 7 : 4;
    else if (zone === "V3") limitH = hasParts ? 12 : 7;
    const dl = toDate(r["Troubleshooting deadline"]);
    out.push({
      id: id,
      name: String(r["Ticket Name"] || "").slice(0, 90),
      st: stKey || null,
      stRaw: stRaw,
      cpid: String(r["Charge Point ID"] || "").trim(),
      err: String(r["Error Code"] || "").slice(0, 60),
      status: status,
      owner: String(r["Ticket Owner"] || "").trim(),
      collab: String(r["Collaborators"] || "").trim(),
      urg: String(r["Urgency Level"] || ""),
      addr: addr.slice(0, 120),
      createT: +createT,
      limitH: limitH,
      // hạn dùng để hiển thị: hạn theo vùng nếu chặt hơn hạn CCTS
      deadline: Math.min(+createT + limitH * HOURS, dl ? +dl : Infinity),
    });
  }
  tickets = out;
  meta = { file: fname, at: Date.now(), by: user.name };
  afterData();
  if (db && user.role === "ADMIN") {
    db.ref("tickets/current").set({ meta: meta, rows: tickets })
      .then(() => toast("Đã đẩy " + tickets.length + " ticket mở HNO cho cả đội"))
      .catch((e) => toast("Lỗi đẩy Firebase: " + e.message, 6000));
  } else {
    localStorage.setItem("fm_tickets", JSON.stringify({ meta: meta, rows: tickets }));
    toast("Đã nạp " + tickets.length + " ticket mở HNO (chế độ offline)");
  }
  render();
}

function afterData() {
  // nạp danh sách owner cho bộ lọc
  const owners = [...new Set(tickets.map((t) => t.owner).filter(Boolean))].sort();
  $("f_owner").innerHTML = '<option value="">Tất cả owner</option>' + owners.map((o) => '<option>' + esc(o) + "</option>").join("");
  // collaborator: tách từng tên (ngăn bằng ; hoặc ,) để SE chọn đúng tên mình
  const collabs = new Set();
  for (const t of tickets) for (const c of tokens(t.collab)) collabs.add(c);
  $("f_collab").innerHTML = '<option value="">Tất cả collaborator</option>' +
    [...collabs].sort().map((c) => "<option>" + esc(c) + "</option>").join("");
  const d = new Date(meta.at);
  $("srcnote").textContent = "● " + (meta.file || "import") + " — " + meta.by + " import lúc " + d.toLocaleTimeString("vi") + " " + d.toLocaleDateString("vi");
  checkStale();
}

// ---------- lọc + vẽ ----------
["f_radius", "f_type", "f_sla", "f_owner", "f_collab"].forEach((id) => $(id).addEventListener("change", render));
$("q").addEventListener("input", () => { clearTimeout(render._h); render._h = setTimeout(render, 250); });
// mở/đóng panel bộ lọc (mobile) kèm nền mờ
function openSide() { $("side").classList.add("open"); $("side-backdrop").classList.add("show"); }
function closeSide() { $("side").classList.remove("open"); $("side-backdrop").classList.remove("show"); }
$("sidetoggle").addEventListener("click", () => $("side").classList.contains("open") ? closeSide() : openSide());
$("side-backdrop").addEventListener("click", closeSide);
$("side-close").addEventListener("click", closeSide);
// "Chỉ ticket của tôi": chọn tên mình trong lọc collaborator (nếu có trong danh sách)
$("btn_mine").addEventListener("click", () => {
  const sel = $("f_collab");
  const me = [...sel.options].find((o) => o.value.toLowerCase() === (user ? user.name.toLowerCase() : ""));
  if (me) { sel.value = me.value; render(); }
  else toast("Không thấy '" + (user ? user.name : "") + "' trong collaborator — chọn tay trong danh sách");
});

function filtered() {
  const q = $("q").value.trim().toLowerCase();
  const rad = +$("f_radius").value || 0;
  const typ = $("f_type").value, sla = $("f_sla").value, own = $("f_owner").value, col = $("f_collab").value;
  return tickets.filter((t) => {
    if (typ && (t.st ? STATIONS[t.st][2] : "") !== typ) return false;
    if (own && t.owner !== own) return false;
    if (col && !tokens(t.collab).includes(col)) return false;
    if (sla && bucketOf(t) !== sla) return false;
    if (rad && myPos && t.st) {
      const s = STATIONS[t.st];
      if (distKm(myPos[0], myPos[1], s[0], s[1]) > rad) return false;
    }
    if (q && !(t.id + " " + t.stRaw + " " + t.cpid + " " + t.err + " " + t.name + " " + t.addr).toLowerCase().includes(q)) return false;
    return true;
  });
}

function nearestSEs(lat, lng) {
  const now = Date.now();
  return Object.values(presence)
    .filter((p) => p.lat && now - p.ts < 15 * 60000)
    .map((p) => ({ p: p, d: distKm(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
}

function render() {
  const keepOpen = openStation; // giữ popup đang mở qua lần vẽ lại (clearLayers sẽ đóng nó)
  const list = filtered();
  tkLayer.clearLayers();

  // gộp ticket theo trạm — marker màu theo ticket gấp nhất
  const byStation = new Map(); let nogeo = 0;
  for (const t of list) {
    if (!t.st) { nogeo++; continue; }
    if (!byStation.has(t.st)) byStation.set(t.st, []);
    byStation.get(t.st).push(t);
  }
  for (const [code, arr] of byStation) {
    arr.sort((a, b) => a.deadline - b.deadline);
    const s = STATIONS[code], worst = arr[0];
    const hasNote = notesOf(code).length > 0; // viền cam = trạm có ghi chú hiện trường
    const mk = L.circleMarker([s[0], s[1]], {
      radius: arr.some((t) => bucketOf(t) === "over" || bucketOf(t) === "b1") ? 10 : 8,
      color: hasNote ? "#f59e0b" : "#fff", weight: hasNote ? 3 : 2,
      fillColor: BCOLOR[bucketOf(worst)], fillOpacity: 0.95,
    }).addTo(tkLayer);
    mk.bindPopup(() => popupHtml(code, arr), { maxWidth: 330 });
    mk._st = code; mk._arr = arr;
  }

  // thống kê
  $("st_show").textContent = list.length;
  $("st_nogeo").textContent = nogeo;
  $("st_urgent").textContent = list.filter((t) => { const b = bucketOf(t); return b === "over" || b === "b1"; }).length;
  const rad = +$("f_radius").value || 10;
  $("st_near").textContent = myPos
    ? list.filter((t) => t.st && distKm(myPos[0], myPos[1], STATIONS[t.st][0], STATIONS[t.st][1]) <= rad).length
    : "—";
  $("st_near").nextElementSibling.textContent = "trong " + rad + " km";

  // danh sách ưu tiên
  const ug = list.slice().sort((a, b) => a.deadline - b.deadline).slice(0, 40);
  $("urgent_list").innerHTML = ug.map((t, i) =>
    '<div class="row" data-i="' + i + '"><span class="dot" style="background:' + BCOLOR[bucketOf(t)] + '"></span>' +
    "<span>" + esc(t.stRaw || t.id) + "<br><span style='color:#64748b;font-size:11px'>" + esc(t.err || t.id) + "</span></span>" +
    '<span class="rem" style="color:' + BCOLOR[bucketOf(t)] + '">' + remText(t) + "</span></div>"
  ).join("") || "<div style='color:#94a3b8;padding:6px 2px'>Chưa có ticket</div>";
  $("urgent_list").querySelectorAll(".row").forEach((el) => {
    el.onclick = () => {
      const t = ug[+el.dataset.i];
      if (t.st) { const s = STATIONS[t.st]; map.setView([s[0], s[1]], 15); openStationPopup(t.st); closeSide(); }
      else toast(t.id + " chưa map được trạm (" + (t.stRaw || "không mã trạm") + ")");
    };
  });
  renderSE();
  if (keepOpen) openStationPopup(keepOpen); // mở lại popup vừa bị clearLayers đóng
}

function openStationPopup(code) {
  tkLayer.eachLayer((l) => { if (l._st === code) l.openPopup(); });
}

function popupHtml(code, arr) {
  const s = STATIONS[code];
  const near = nearestSEs(s[0], s[1]);
  return "<b>" + esc(code) + "</b> · " + (s[2] === "B" ? "BSS" : "EVCS") +
    "<br><span style='color:#64748b'>" + esc(s[3]) + (s[4] ? " — " + esc(s[4]) : "") + "</span>" +
    "<div style='margin:5px 0 3px;font-size:11px;color:#64748b'>" + arr.length + " ticket mở:</div>" +
    arr.map((t) => {
      const b = bucketOf(t);
      return '<div class="tk"><span class="pill" style="background:' + BCOLOR[b] + '">' + remText(t) + "</span> <b>" + esc(t.id) + "</b> (SLA " + t.limitH + "h)" +
        "<br>" + esc(t.err || "—") + " · " + esc(t.status) +
        (t.cpid ? "<br><span style='color:#64748b'>Trụ/tủ: " + esc(t.cpid) + "</span>" : "") +
        (t.owner ? "<br><span style='color:#64748b'>Owner: " + esc(t.owner) + "</span>" : "") + "</div>";
    }).join("") +
    (near.length ? "<div style='margin-top:6px;border-top:2px solid #e2e8f0;padding-top:5px'><b>Gần nhất:</b> " +
      near.map((n) => esc(n.p.name) + " (" + n.d.toFixed(1) + " km)").join(" · ") + "</div>" : "") +
    notesHtml(code);
}

// ---------- ghi chú tại trạm (đồng bộ Firebase) ----------
const TYPE_LABEL = { addr: "Sửa địa chỉ", site: "Bất thường / góp ý" };
let noteDraft = { code: null, type: "site", text: "" }; // giữ nội dung đang gõ qua các lần vẽ lại
// mã trạm có dấu "." — không hợp làm key Firebase, thay bằng "_"
function noteKey(code) { return String(code).replace(/[.#$/\[\]]/g, "_"); }
function notesOf(code) {
  const o = notes[noteKey(code)] || {};
  return Object.entries(o).map(([nid, n]) => ({ nid, ...n })).sort((a, b) => a.ts - b.ts);
}
function notesHtml(code) {
  const list = notesOf(code);
  const canDel = (n) => user && (user.role === "ADMIN" || n.by === user.name);
  const items = list.map((n) => {
    const t = n.type === "addr" ? "addr" : "site";
    return '<div class="note ' + t + '">' +
      (canDel(n) ? '<span class="del" onclick="fmDelNote(\'' + esc(code) + "','" + n.nid + '\')">✕</span>' : "") +
      '<span class="tag">' + TYPE_LABEL[t] + "</span><br>" + esc(n.text) +
      '<div class="meta">' + esc(n.by) + " · " + fmtAgo(n.ts) + "</div></div>";
  }).join("");
  const d = noteDraft.code === code ? noteDraft : { type: "site", text: "" };
  const opt = (v, lbl) => '<option value="' + v + '"' + (d.type === v ? " selected" : "") + ">" + lbl + "</option>";
  return '<div class="notes"><div class="nhead">📝 Ghi chú tại trạm' + (list.length ? " (" + list.length + ")" : "") + "</div>" +
    (items || "<div style='color:#94a3b8;font-size:11.5px'>Chưa có ghi chú.</div>") +
    '<div class="noteform">' +
    '<select id="note_type" onchange="fmDraft(\'' + esc(code) + '\')">' +
    opt("site", "Bất thường / góp ý tại site") + opt("addr", "Sửa địa chỉ (địa chỉ sai)") + "</select>" +
    '<textarea id="note_text" oninput="fmDraft(\'' + esc(code) + '\')" placeholder="vd: địa chỉ đúng là… / trạm bị ngập, khó vào ban đêm…">' + esc(d.text) + "</textarea>" +
    '<button onclick="fmAddNote(\'' + esc(code) + '\')">Thêm ghi chú</button></div></div>';
}
function fmtAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return m + " phút trước";
  const h = Math.round(m / 60);
  if (h < 24) return h + " giờ trước";
  return new Date(ts).toLocaleDateString("vi");
}
function fmDraft(code) { noteDraft = { code: code, type: $("note_type").value, text: $("note_text").value }; }
function fmAddNote(code) {
  const text = $("note_text").value.trim();
  if (!text) return toast("Nhập nội dung ghi chú");
  if (!user) return;
  const entry = { type: $("note_type").value === "addr" ? "addr" : "site", text: text.slice(0, 300), by: user.name, ts: Date.now() };
  const key = noteKey(code);
  noteDraft = { code: null, type: "site", text: "" }; // xóa nháp sau khi gửi
  if (db) {
    db.ref("notes/" + key).push(entry).catch((e) => toast("Lỗi lưu ghi chú: " + e.message, 6000));
  } else { // offline: chỉ lưu máy này
    notes[key] = notes[key] || {};
    notes[key]["local_" + Date.now()] = entry;
    localStorage.setItem("fm_notes", JSON.stringify(notes));
    render();
  }
  toast("Đã thêm ghi chú");
}
function fmDelNote(code, nid) {
  if (!confirm("Xóa ghi chú này?")) return;
  const key = noteKey(code);
  if (db) db.ref("notes/" + key + "/" + nid).remove();
  else {
    if (notes[key]) delete notes[key][nid];
    localStorage.setItem("fm_notes", JSON.stringify(notes));
    render();
  }
}
map.on("popupopen", (e) => { openStation = (e.popup._source && e.popup._source._st) || null; });
map.on("popupclose", () => { openStation = null; });

// ---------- vẽ SE online ----------
function renderSE() {
  seLayer.clearLayers();
  const now = Date.now();
  for (const uid in presence) {
    if (uid === myUid) continue;
    const p = presence[uid];
    if (!p.lat || now - p.ts > 30 * 60000) continue; // quá 30' coi như offline
    const stale = now - p.ts > 3 * 60000;
    const cls = "se-ic" + (stale ? " stale" : p.role === "ADMIN" ? " admin" : "");
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: "", html: '<div class="' + cls + '" style="width:26px;height:26px">' + esc(p.name.charAt(0).toUpperCase()) + "</div>", iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).addTo(seLayer).bindPopup("<b>" + esc(p.name) + "</b> · " + esc(p.role) +
      "<br>Cập nhật " + Math.round((now - p.ts) / 60000) + " phút trước" +
      (myPos ? "<br>Cách bạn " + distKm(myPos[0], myPos[1], p.lat, p.lng).toFixed(1) + " km" : ""));
  }
}
function renderOnline() {
  const now = Date.now();
  const on = Object.entries(presence).filter(([, p]) => now - p.ts < 30 * 60000);
  $("online_n").textContent = on.length;
  $("online_list").innerHTML = on.map(([uid, p]) =>
    '<div class="row" style="display:flex;gap:6px;padding:4px 0;cursor:pointer" data-u="' + uid + '">' +
    '<span class="dot" style="background:' + (now - p.ts > 3 * 60000 ? "#f59e0b" : "#0ea5e9") + ';margin-top:3px"></span>' +
    esc(p.name) + " <span style='color:#94a3b8'>· " + esc(p.role) + (uid === myUid ? " (bạn)" : "") + "</span></div>"
  ).join("") || "<div style='color:#94a3b8'>Chưa có ai online</div>";
  $("online_list").querySelectorAll("[data-u]").forEach((el) => {
    el.onclick = () => { const p = presence[el.dataset.u]; if (p && p.lat) map.setView([p.lat, p.lng], 14); };
  });
}

// ---------- cảnh báo dữ liệu cũ (monitor đẩy 10'/lần; quá 20' không mới = có sự cố) ----------
const STALE_MS = 20 * 60000;
function checkStale() {
  const bar = $("stalebar");
  if (!db || !meta || !meta.at) { bar.style.display = "none"; return; }
  const age = Date.now() - meta.at;
  if (age > STALE_MS) {
    bar.textContent = "⚠ Dữ liệu cũ " + Math.round(age / 60000) + " phút — chạm để tải lại";
    bar.style.display = "block";
  } else bar.style.display = "none";
}
// chạm banner = tải lại kèm phá cache (lấy code + dữ liệu mới nhất)
$("stalebar").addEventListener("click", () => { location.href = location.pathname + "?r=" + Date.now(); });

// đồng hồ SLA: tô lại màu mỗi 30 giây (bỏ qua khi đang mở popup để không cắt ngang SE gõ note)
setInterval(() => { if (tickets.length && !openStation) render(); renderOnline(); checkStale(); }, 30000);

// ---------- vào app ----------
try { user = JSON.parse(localStorage.getItem("fm_user") || "null"); } catch (e) {}
if (user && user.name) enter();
