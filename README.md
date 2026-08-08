# CCTS Field Map — HNO

Bản đồ điều phối sự cố khu vực Hà Nội: import `Tickets.xlsx` từ CCTS → hiện ticket đang mở
trên bản đồ theo **SLA còn lại** (màu), kèm **vị trí SE real-time** để biết ai gần sự cố nhất.

Toàn bộ chạy **0 đồng**: frontend tĩnh (host miễn phí) + Firebase Realtime Database gói Spark (miễn phí).

## Thành phần

| File | Vai trò |
|---|---|
| `index.html` + `app.js` | App chính (Leaflet + SheetJS, chạy hoàn toàn trên trình duyệt) |
| `config.js` | Điền Firebase config + mã admin (xem bên dưới) |
| `libs/stations_hno.js` | Tọa độ 6.464 trạm/tủ Hà Nội — sinh bởi `build_stations.py` |
| `libs/station_map.js` | Vùng SLA nhanh V1/V2/V3 (dùng chung với dashboard) |
| `build_stations.py` | Chạy lại khi có file trạm mới: `py build_stations.py <EVCS.xlsx> <BSS.xlsx>` |

## Logic SLA còn lại

- Ticket **đang mở** (không Closed/Canceled), trạm HN hoặc địa chỉ chứa "Hà Nội".
- Hạn xử lý = Create Time + hạn vùng: **V1=3h; V2=4h (có vật tư 7h); V3=7h (có vật tư 12h); còn lại 48h**.
  SLA nhanh chỉ áp cho ticket nguồn API creation (rule 07/07/2026). Nếu CCTS có
  "Troubleshooting deadline" sớm hơn thì lấy hạn sớm hơn.
- Màu: xanh >24h → vàng → cam → đỏ 0–1h → đỏ đậm quá hạn.

## Bước 1 — Tạo Firebase (5 phút, miễn phí, không cần thẻ)

1. Vào https://console.firebase.google.com → **Add project** (tên tùy ý, tắt Analytics).
2. Cột trái **Databases & Storage → Realtime Database → Create database** → chọn `asia-southeast1` (Singapore) → chế độ **locked**.
   (Giao diện cũ: menu **Build → Realtime Database**.)
3. Tab **Rules**: dán nguyên nội dung file **`firebase.rules.json`** trong thư mục này → Publish.
4. Cột trái **Security → Authentication → Get started → Sign-in method**: bật **Anonymous**
   (cho SE) và **Email/Password** (cho CSE/Admin + bot).
5. Trang Project Overview bấm **+ Add app → biểu tượng `</>` (Web)** → đặt tên → copy khối `firebaseConfig` dán vào `config.js` (chỉ cần `apiKey`, `authDomain`, `databaseURL`, `projectId`).
   Nếu khối config thiếu `databaseURL`: lấy URL ở đầu trang Realtime Database (dạng
   `https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app`) tự thêm vào.

Chưa làm bước này app vẫn chạy được ở **chế độ offline** (một máy, không chia sẻ GPS).

## Bước 1b — Phân quyền (BẮT BUỘC trước khi dùng thật)

Từ 20/07/2026 **bỏ mã admin chung** (`ADMIN_CODE` nằm trong file công khai — ai xem source cũng
đọc được, và ai cũng tự chọn được vai trò CSE để duyệt sửa tọa độ). Thay bằng: **SE vào ẩn danh
(chỉ nhập tên); CSE/Admin đăng nhập email + mật khẩu; quyền thật nằm ở node `/roles` và được
Security Rules cưỡng chế** — client chỉ hiển thị.

Thứ tự làm (làm đúng thứ tự để không gãy pusher đang chạy):

1. **Authentication → Users → Add user**: tạo từng tài khoản CSE/Admin
   (vd `vinh@fieldmap.local` — email không cần có thật) và MỘT tài khoản bot cho máy đẩy dữ liệu
   (vd `bot@fieldmap.local`, mật khẩu dài ngẫu nhiên).
2. **Realtime Database → Data**: tạo node `roles` → con là từng `uid` (copy cột User UID ở tab
   Users) với giá trị chuỗi: `"ADMIN"`, `"CSE"` hoặc `"BOT"`. Ví dụ:
   `roles/AbC123…: "ADMIN"`, `roles/XyZ456…: "BOT"`.
3. Trên máy chạy sla_monitor: thêm vào `sla_monitor/.env`:
   `FIREBASE_BOT_EMAIL=bot@fieldmap.local` + `FIREBASE_BOT_PASSWORD=…` rồi test
   `python fieldmap_push.py --once` (mọi pusher: fieldmap/dashboard/push_export/station_history
   dùng chung đăng nhập này).
4. **Cuối cùng** mới dán `firebase.rules.json` vào tab Rules → Publish. (Publish trước khi có
   bot + roles thì pusher và Import Excel sẽ bị `permission denied`.)

Ai được làm gì sau khi bật:

| Node | SE (ẩn danh) | CSE | Admin | Bot |
|---|---|---|---|---|
| `tickets`, `dashboard/current·full·stations` | đọc | đọc | đọc + ghi | ghi |
| `presence` | ghi uid mình | như SE | như SE | — |
| `notes` | tạo; sửa/xóa của mình | xóa mọi ghi chú | xóa mọi ghi chú | — |
| `dashboard/station_fixes` (đề xuất tọa độ) | tạo | tạo | tạo | — |
| `dashboard/station_overrides` (duyệt tọa độ) | — | ghi | ghi | — |
| `roles` | đọc | đọc | ghi | — |

Còn mở có chủ đích: `dashboard/explain` vẫn `auth != null` vì web dashboard/report (đăng nhập
ẩn danh) đang ghi giải trình vào đó — siết nốt thì phải chuyển 2 web kia sang tài khoản thật.

## Bước 2 — Host miễn phí (link cố định, không chết như trycloudflare)

Cách dễ nhất — **GitHub Pages**:
1. Tạo repo (private cũng được với GitHub Pro; public cũng an toàn — không còn mã bí mật nào trong source, quyền nằm ở Security Rules).
2. Đẩy toàn bộ thư mục `fieldmap/` lên repo.
3. Settings → Pages → Deploy from branch → nhánh `main`, thư mục `/ (root)`.
4. Link dạng `https://<user>.github.io/<repo>/` — gửi cho cả đội, mở trên điện thoại là chạy.

Thay thế: Cloudflare Pages / Netlify (kéo thả thư mục là xong). **Bắt buộc HTTPS** vì trình duyệt
chỉ cho lấy GPS trên HTTPS (hoặc localhost).

## Bước 3 — Dùng hằng ngày

- **Admin/CSE**: chọn vai trò → đăng nhập email + mật khẩu (Admin tạo ở Bước 1b). Admin có nút
  **Import Excel** file export `Tickets.xlsx` từ CCTS → dữ liệu đẩy tức thì cho mọi máy đang mở app.
- **SE**: mở link, nhập tên → cho phép quyền vị trí → icon của mình hiện trên bản đồ,
  vị trí gửi khi di chuyển >100m (tối thiểu 90s/lần). Tắt tab = offline ngay.
- Bấm 1 ticket trong danh sách "Ưu tiên xử lý" → bay tới trạm, popup hiện chi tiết + 3 SE gần nhất.

## Giới hạn gói miễn phí (đủ cho HNO)

- Firebase Spark: **100 kết nối đồng thời**, 1 GB lưu, 10 GB tải/tháng — đội ~50 người dùng cả ngày
  ước tính ~1 GB/tháng.
- Muốn "real-time hơn": tăng tần suất trong `config.js` (`HEARTBEAT_S`), đổi ngưỡng 100m trong `app.js`.

## Nâng cấp sau (chưa làm ở v1)

- Nhật ký 24h (log import/di chuyển) — thêm node `/log` trong RTDB.
- Nhận ticket ("tôi xử lý cái này") + trạng thái di chuyển của SE.

## Bộ lọc Collaborator + Ghi chú tại trạm (đã có)

- **Lọc Collaborator**: chọn tên SE trong danh sách để chỉ xem ticket mình phối hợp; nút
  "Chỉ ticket của tôi" tự chọn theo tên đăng nhập nếu khớp.
- **Ghi chú tại trạm**: mở popup một trạm → phần "📝 Ghi chú tại trạm" cho SE thêm 2 loại:
  *Sửa địa chỉ* (địa chỉ sai) và *Bất thường / góp ý tại site*. Ghi chú đồng bộ real-time
  cho cả đội; trạm có ghi chú viền cam trên bản đồ. Người tạo hoặc Admin xóa được ghi chú.
- **Cần rule `/notes`** ở Bước 1 (xem trên) — nếu không sẽ báo `permission_denied` khi lưu.

## Lỗi lặp lại + Log CPO từ VOMS (08/08/2026)

Hai thông tin mới bám theo từng ticket, `sla_monitor` tính/lấy sẵn rồi đẩy kèm vào
`/tickets/current` — web **không** gọi thêm API nào.

**1. 🔁 Lặp lại SN + mã lỗi trong 30 ngày** (trường `rep`)

- Đếm số ticket **cùng S/N thiết bị** (`chargeBoxId` — chính là SN nằm trong tên ticket CCTS)
  **và cùng mã lỗi**, tạo trong 30 ngày gần nhất, **mọi trạng thái kể cả đã đóng**, tính cả
  ticket đang xem. Nguồn: `history_cache.json` mà monitor đã kéo sẵn → **0 request thêm cho CCTS**.
- Hiện ở: danh sách "Ưu tiên xử lý", popup trạm, và header + ô "Lỗi lặp lại" của workspace.
  Chỉ hiện khi ≥ 2 lần; màu cam (2) → đỏ (3–4) → đỏ đậm (≥5).
- Nút **xem** trong workspace nhảy sang tab Lịch sử với sẵn bộ lọc 30 ngày + cùng Error Code.
  Lưu ý: tab Lịch sử lọc theo **trạm**, huy hiệu đếm theo **SN**, nên trạm nhiều trụ/tủ thì hai
  số lệch nhau là đúng.
- `rep = 0` nghĩa là **chưa biết** (ticket vào bằng Import Excel tay không có lịch sử để đếm),
  không phải "0 lần" → web ẩn huy hiệu.

**2. 🛰️ VOMS: số lần lặp cảnh báo + Log CPO** (`vCase/vRep/vType/vStatus/vLogs`)

- Ghép ticket CCTS với Repair Case bên `voms.vgreen.net` theo **Mã yêu cầu**
  (CCTS `third_id` == VOMS `caseCode`, dạng `RC-…` / `BS-…`).
- `vRep` = `cpoRepeatCount` — **"Số lần lặp"** của cảnh báo do CPO đếm. Đây là con số **khác**
  với `rep` ở trên (`rep` đếm số *ticket*, `vRep` đếm số lần *cảnh báo* lặp).
- `vLogs` = 5 dòng **Log CPO** gần nhất (thời gian, tên cảnh báo, trạng thái CPO, mã CPO).
- Hiện ở: một dòng gọn trong popup trạm, và khối "🛰️ VOMS" đầy đủ trong tab Tổng quan.
  Không ghép được mã yêu cầu → **không hiện khối này** (thay vì hiện số 0).

⚠️ **Chỉ trụ sạc (EVCS) mới có Log CPO và số lần lặp.** Kiểm chứng trên dữ liệu thật 08/08/2026:

| Ticket | Mã yêu cầu | Bên VOMS | Log CPO + số lần lặp |
|---|---|---|---|
| EVCS | `RC-…` | `/repair-orders` | **Có** (khi yêu cầu do CPO sinh) |
| BSS | `BS-…` | `/es/repair-orders` | **Không có** — VOMS không lưu cho tủ đổi pin |

Yêu cầu `RC-` nhưng do **CSKH** tạo cũng không có. Trong hai trường hợp đó ô "Số lần lặp"
ghi rõ **lý do** ("Tủ đổi pin — VOMS không có Log CPO cho BSS" / "Yêu cầu do CSKH tạo…")
chứ không hiện số 0.
- Bật ở phía `sla_monitor`: điền `VOMS_EMAIL` trong `.env` rồi lấy phiên **một lần** —
  `python voms.py --login` (email + mật khẩu + OTP), hoặc `python voms.py --from-browser`
  (dán `localStorage['auth-storage']` từ trình duyệt đang đăng nhập; **bắt buộc dùng đường này
  nếu tài khoản là Microsoft SSO**). Chưa làm bước này thì bản đồ vẫn chạy bình thường,
  chỉ thiếu phần VOMS.

## Tự động đồng bộ ticket (đã nối sla_monitor)

Không cần Import Excel tay nữa: `sla_monitor` (thư mục cạnh bên) mỗi chu kỳ quét CCTS
sẽ tự đẩy ticket tồn (nhóm hungvu + API creation) lên `/tickets/current` — web nhận real-time.

- Cấu hình: `sla_monitor/.env` đã có `FIREBASE_API_KEY` + `FIREBASE_DB_URL`. Để trống 2 dòng
  này = tắt đẩy (monitor vẫn chạy Telegram bình thường).
- Module `sla_monitor/fieldmap_push.py` lo phần biến đổi + đẩy; `monitor.py` gọi nó trong
  `run_cycle` (đã guard: lỗi Firebase không làm hỏng luồng cảnh báo Telegram).
- Test thủ công không cần chờ chu kỳ: `python fieldmap_push.py --once` (tự fetch 1 lần)
  hoặc `--dry` (in JSON, không đẩy).
- Lần đầu cần: `python monitor.py --login` (đăng nhập CCTS) rồi `.\register_task.ps1`
  (đăng ký Task Scheduler chạy mỗi 10 phút). Từ đó ticket mới lên bản đồ sau vài phút.
