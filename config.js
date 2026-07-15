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

// 2) Mã mở quyền Admin (được import Excel + đẩy dữ liệu cho cả đội) — đổi trước khi dùng thật
const ADMIN_CODE = "P6RCJ0NL";

// 3) Tần suất gửi vị trí: gửi khi di chuyển >100m, tối thiểu HEARTBEAT_S giây/lần khi đứng yên
const HEARTBEAT_S = 90;
