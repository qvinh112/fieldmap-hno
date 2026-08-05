// ===== Cấu hình Field Map HNO =====
// 1) FIREBASE_CONFIG: tạo project miễn phí tại https://console.firebase.google.com
//    (Build -> Realtime Database -> Create; Project settings -> General -> Your apps -> Web app -> copy config)
//    Để null = chạy chế độ OFFLINE (chỉ xem trên máy này, không chia sẻ GPS/ticket).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAyWWhY2Bh-Irw7mbHh-nz3DZN4O3lupTE",
  authDomain: "mappingslahno.firebaseapp.com",
  databaseURL: "https://mappingslahno-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mappingslahno",
};
// Để FIREBASE_CONFIG = null nếu muốn quay lại chế độ OFFLINE (một máy, không chia sẻ GPS/ticket).

// 2) Quyền CSE/Admin KHÔNG còn dùng mã chung (mã trong file công khai = ai cũng đọc được).
//    CSE/Admin đăng nhập bằng tài khoản email/mật khẩu do Admin tạo trong Firebase console,
//    quyền thật nằm ở node /roles/<uid> + Security Rules (xem README + firebase.rules.json).

// 3) Tần suất gửi vị trí: gửi khi di chuyển >100m, tối thiểu HEARTBEAT_S giây/lần khi đứng yên
const HEARTBEAT_S = 90;

// 4) Field Copilot: CHỈ URL của backend (KHÔNG bao giờ để API key ở đây — file này công khai).
//    Để trống/null = Copilot tắt (workspace vẫn chạy các tab khác).
//    Dev local: "http://localhost:8900"; production: URL backend đã deploy riêng.
const COPILOT_API_URL = null;

// 5) Tóm tắt AI lịch sử trạm (khối "✨ Tóm tắt AI" ở popup bản đồ và tab Lịch sử của workspace).
//    false = TẮT hiển thị (05/08/2026, theo yêu cầu user). Lịch sử ticket vẫn hiện đầy đủ.
//    Lưu ý: cờ này chỉ tắt phần HIỂN THỊ. Bên sinh dữ liệu là sla_monitor/station_history.py
//    vẫn gọi DeepSeek (trần 200 lượt/lần chạy) và vẫn ghi trường `ai` lên Firebase — muốn
//    ngừng tốn tiền thì phải tắt cả bên đó.
const AI_SUMMARY_ON = false;
