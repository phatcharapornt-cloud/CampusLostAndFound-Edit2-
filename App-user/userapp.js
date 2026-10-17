// โค้ดที่หน้าหลังเข้าสู่ระบบของ App-user ใช้ร่วมกัน: ตรวจการเข้าสู่ระบบ, แถบเมนูด้านล่าง, toast และฟังก์ชันช่วย
//
// วิธีใช้ในหน้าใหม่:
//   <body class="is-checking">
//     <div class="phone">
//       <div class="dynamic-island"></div>
//       <div class="phone-scroll"> ...เนื้อหา... </div>
//       <nav class="bottom-nav" id="bottom-nav"></nav>
//       <div class="toast" id="toast" role="status" aria-live="polite"></div>
//     </div>
//     <script src="userapp.js"></script>
//     <script>
//       const user = UserApp.init('myitems');   // key ของหน้านี้ใน PAGES ด้านล่าง
//     </script>
//
// เมื่อสร้างหน้าใหม่เสร็จ ให้เปลี่ยน ready: false เป็น true ใน PAGES ปุ่ม/เมนูที่ลิงก์ไปหน้านั้นจะกดได้ทันที

const UserApp = (() => {
    // ที่อยู่ของ Backend (ตรงกับ PORT ในไฟล์ Backend/.env)
    const API_BASE_URL = 'http://localhost:5001';
    // key ที่หน้า login.html ใช้เก็บข้อมูลผู้ใช้ที่เข้าสู่ระบบ
    const CURRENT_USER_KEY = 'currentUser';
    const LOGIN_PAGE = 'login.html';

    const PAGES = {
        home:        { label: 'หน้าแรก',          icon: 'fa-solid fa-house',            href: 'home.html',        ready: true },
        myitems:     { label: 'รายการของฉัน',     icon: 'fa-solid fa-list-ul',          href: 'myitems.html',     ready: true },
        profile:     { label: 'โปรไฟล์',          icon: 'fa-regular fa-user',           href: 'profile.html',     ready: false },
        reportFound: { label: 'แจ้งสิ่งของที่พบ',   icon: 'fa-solid fa-hand-holding-heart', href: 'reportfound.html', ready: true },
        reportLost:  { label: 'แจ้งสิ่งของที่หาย',  icon: 'fa-solid fa-magnifying-glass',  href: 'reportlost.html',  ready: true },
        notifications: { label: 'การแจ้งเตือน',    icon: 'fa-regular fa-bell',           href: 'notifications.html', ready: true },
        mail:        { label: 'อีเมล',             icon: 'fa-regular fa-envelope',       href: 'mail.html',        ready: true },   // อีเมลจำลอง (ไม่ได้ส่งจริง)
    };
    const BOTTOM_NAV = ['home', 'myitems', 'profile'];

    function escapeHtml(text) {
        return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // ---------- ผู้ใช้ที่เข้าสู่ระบบ ----------
    function getUser() {
        try {
            const user = JSON.parse(localStorage.getItem(CURRENT_USER_KEY));
            return user && user.User_ID && user.role === 'user' ? user : null;
        } catch {
            return null;
        }
    }

    function logout() {
        try { localStorage.removeItem(CURRENT_USER_KEY); } catch { /* ไม่เป็นไร */ }
        window.location.replace(LOGIN_PAGE);
    }

    // ---------- toast ----------
    let toastTimer = null;
    function toast(message) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = message;
        el.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
    }

    // ไปหน้าอื่น (ถ้าหน้านั้นยังไม่ได้สร้าง จะแจ้งว่า "เร็ว ๆ นี้" แทน)
    function goTo(key) {
        const page = PAGES[key];
        if (page && page.ready) {
            window.location.href = page.href;
        } else {
            toast(`หน้า "${page ? page.label : ''}" กำลังพัฒนา เร็ว ๆ นี้`);
        }
    }

    function renderBottomNav(activeKey) {
        const nav = document.getElementById('bottom-nav');
        if (!nav) return;
        nav.setAttribute('aria-label', 'เมนูหลัก');
        nav.innerHTML = BOTTOM_NAV.map((key) => {
            const page = PAGES[key];
            const active = key === activeKey;
            const inner = `<i class="${page.icon}" aria-hidden="true"></i><span>${escapeHtml(page.label)}</span>`;
            if (active) return `<span class="nav-tab is-active" aria-current="page">${inner}</span>`;
            if (page.ready) return `<a class="nav-tab" href="${page.href}">${inner}</a>`;
            return `<button type="button" class="nav-tab" data-goto="${key}">${inner}</button>`;
        }).join('');
        nav.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => goTo(btn.dataset.goto)));
    }

    // เรียกตอนต้นของทุกหน้าที่ต้องเข้าสู่ระบบ: ไม่มีผู้ใช้ → กลับหน้า login, มี → วาดเมนูด้านล่าง แล้วคืนค่าข้อมูลผู้ใช้
    function init(activeKey) {
        const user = getUser();
        if (!user) {
            window.location.replace(LOGIN_PAGE);
            return null;
        }
        renderBottomNav(activeKey);
        document.body.classList.remove('is-checking');
        return user;
    }

    // ---------- เรียก API ----------
    async function apiGet(path) {
        const response = await fetch(`${API_BASE_URL}${path}`);
        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
    }

    // ส่งข้อมูลแบบ JSON (ถ้าเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ จะ throw error ให้หน้าที่เรียกจัดการเอง)
    async function apiSend(method, path, body) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
    }
    const apiPost = (path, body) => apiSend('POST', path, body);
    const apiPut = (path, body) => apiSend('PUT', path, body);

    // รูปที่เก็บใน Backend (เช่น /uploads/found_123.png) → URL เต็ม
    function photoUrl(path) {
        if (!path) return '';
        return /^https?:\/\//.test(path) ? path : `${API_BASE_URL}${path}`;
    }

    // วันที่/เวลาที่พบ: "วันนี้ 13:05", "เมื่อวาน 12:10", "14 ต.ค. 15:00"
    function formatFoundDate(dateText, timeText) {
        if (!dateText) return '';
        const [y, m, d] = dateText.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.round((today - date) / 86400000);
        const time = timeText ? ` ${timeText} น.` : '';
        if (diffDays === 0) return `วันนี้${time}`;
        if (diffDays === 1) return `เมื่อวาน${time}`;
        const sameYear = date.getFullYear() === today.getFullYear();
        return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: '2-digit' }) }) + time;
    }

    return { API_BASE_URL, PAGES, init, getUser, logout, goTo, toast, apiGet, apiPost, apiPut, photoUrl, formatFoundDate, escapeHtml };
})();