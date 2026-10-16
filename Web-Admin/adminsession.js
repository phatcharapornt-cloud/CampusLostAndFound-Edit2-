// โค้ดที่ทุกหน้าของ Web-Admin ใช้ร่วมกัน: เก็บ/อ่านการเข้าสู่ระบบ และเรียก API พร้อม token
// ใส่ในหน้า HTML ด้วย <script src="admin-session.js"></script> ก่อน script ของหน้านั้น
//
// ตัวอย่างการเรียก API ที่ต้องเป็น Admin ในหน้าใหม่:
//   const data = await AdminSession.apiFetch('/api/admin/pendingfound');

const AdminSession = (() => {
    // ที่อยู่ของ Backend (ตรงกับ PORT ในไฟล์ Backend/.env)
    const API_BASE_URL = 'http://localhost:5001';
    const STORAGE_KEY = 'adminSession';   // เก็บ { token, admin, expiresAt } ใน localStorage
    const LOGIN_PAGE = 'login.html';

    function get() {
        try {
            const session = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (!session || !session.token || !session.expiresAt) return null;
            if (session.expiresAt * 1000 <= Date.now()) return null;   // token หมดอายุแล้ว
            return session;
        } catch {
            return null;
        }
    }

    function save(session) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch {
            /* เบราว์เซอร์ไม่ให้บันทึก: ยังใช้งานหน้านี้ต่อได้ แต่รีเฟรชแล้วต้องเข้าสู่ระบบใหม่ */
        }
    }

    function clear() {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ไม่เป็นไร */ }
    }

    // ส่งกลับไปหน้าเข้าสู่ระบบ (reason: 'expired' = หมดเวลา, 'logout' = ออกจากระบบเอง)
    function redirectToLogin(reason) {
        clear();
        window.location.replace(reason ? `${LOGIN_PAGE}?${reason}=1` : LOGIN_PAGE);
    }

    // ใช้ตอนต้นของทุกหน้าที่ต้องเข้าสู่ระบบก่อน: ไม่มี session → กลับหน้า login ทันที
    function requireLogin() {
        const session = get();
        if (!session) {
            let hadSession = false;   // เคยเข้าสู่ระบบไว้แต่หมดอายุ → แจ้งว่าหมดเวลา
            try { hadSession = localStorage.getItem(STORAGE_KEY) !== null; } catch { /* ไม่เป็นไร */ }
            redirectToLogin(hadSession ? 'expired' : '');
            return null;
        }
        // ออกจากระบบอัตโนมัติเมื่อ token หมดอายุระหว่างเปิดหน้าอยู่
        const msLeft = session.expiresAt * 1000 - Date.now();
        setTimeout(() => redirectToLogin('expired'), Math.min(msLeft, 2147483647));
        return session;
    }

    // เรียก API ของ Backend พร้อมแนบ token (ถ้าได้ 401 แปลว่า token ใช้ไม่ได้แล้ว → กลับหน้า login)
    async function apiFetch(path, options = {}) {
        const session = get();
        const headers = { ...(options.headers || {}) };
        if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        if (session) headers.Authorization = `Bearer ${session.token}`;

        const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            redirectToLogin('expired');
            const error = new Error(data.message || 'unauthorized');
            error.unauthorized = true;   // หน้าที่เรียกใช้เช็กได้ว่ากำลังถูกพากลับหน้า login
            throw error;
        }
        return { ok: response.ok, status: response.status, data };
    }

    return { API_BASE_URL, get, save, clear, requireLogin, redirectToLogin, apiFetch };
})();