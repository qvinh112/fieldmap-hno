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
3. Tab **Rules**, dán rồi Publish:
```json
{
  "rules": {
    "presence": { ".read": "auth != null", "$uid": { ".write": "auth != null && auth.uid == $uid" } },
    "tickets":  { ".read": "auth != null", ".write": "auth != null" }
  }
}
```
4. Cột trái **Security → Authentication → Get started → Sign-in method → Anonymous → Enable**.
5. Trang Project Overview bấm **+ Add app → biểu tượng `</>` (Web)** → đặt tên → copy khối `firebaseConfig` dán vào `config.js` (chỉ cần `apiKey`, `authDomain`, `databaseURL`, `projectId`).
   Nếu khối config thiếu `databaseURL`: lấy URL ở đầu trang Realtime Database (dạng
   `https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app`) tự thêm vào.

Chưa làm bước này app vẫn chạy được ở **chế độ offline** (một máy, không chia sẻ GPS).

## Bước 2 — Host miễn phí (link cố định, không chết như trycloudflare)

Cách dễ nhất — **GitHub Pages**:
1. Tạo repo (private cũng được với GitHub Pro; public thì lưu ý đổi `ADMIN_CODE`).
2. Đẩy toàn bộ thư mục `fieldmap/` lên repo.
3. Settings → Pages → Deploy from branch → nhánh `main`, thư mục `/ (root)`.
4. Link dạng `https://<user>.github.io/<repo>/` — gửi cho cả đội, mở trên điện thoại là chạy.

Thay thế: Cloudflare Pages / Netlify (kéo thả thư mục là xong). **Bắt buộc HTTPS** vì trình duyệt
chỉ cho lấy GPS trên HTTPS (hoặc localhost).

## Bước 3 — Dùng hằng ngày

- **Admin**: đăng nhập vai trò Admin (mã trong `config.js`) → **Import Excel** file export
  `Tickets.xlsx` từ CCTS → dữ liệu đẩy tức thì cho mọi máy đang mở app.
- **SE/CSE**: mở link, nhập tên → cho phép quyền vị trí → icon của mình hiện trên bản đồ,
  vị trí gửi khi di chuyển >100m (tối thiểu 90s/lần). Tắt tab = offline ngay.
- Bấm 1 ticket trong danh sách "Ưu tiên xử lý" → bay tới trạm, popup hiện chi tiết + 3 SE gần nhất.

## Giới hạn gói miễn phí (đủ cho HNO)

- Firebase Spark: **100 kết nối đồng thời**, 1 GB lưu, 10 GB tải/tháng — đội ~50 người dùng cả ngày
  ước tính ~1 GB/tháng.
- Muốn "real-time hơn": tăng tần suất trong `config.js` (`HEARTBEAT_S`), đổi ngưỡng 100m trong `app.js`.

## Nâng cấp sau (chưa làm ở v1)

- Nhật ký 24h (log import/di chuyển) — thêm node `/log` trong RTDB.
- Nhận ticket ("tôi xử lý cái này") + trạng thái di chuyển của SE.

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
