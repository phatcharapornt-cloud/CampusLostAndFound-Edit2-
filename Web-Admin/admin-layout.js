// สร้างแถบเมนูซ้าย + แถบบน ให้ทุกหน้าของ Web-Admin (ต้องใส่ admin-session.js ก่อนไฟล์นี้)
//
// วิธีใช้ในหน้าใหม่:
//   <body class="is-checking">
//     <div class="admin-app">
//       <aside class="admin-sidebar" id="admin-sidebar"></aside>
//       <div class="admin-main">
//         <header class="admin-topbar" id="admin-topbar"></header>
//         <main class="admin-content"> ...เนื้อหาของหน้า... </main>
//       </div>
//     </div>
//     <div class="admin-backdrop" id="admin-backdrop"></div>
//     <script src="admin-session.js"></script>
//     <script src="admin-layout.js"></script>
//     <script>
//       const session = AdminLayout.init('approve-found');   // key ของหน้านี้ใน PAGES ด้านล่าง
//     </script>
//
// เมื่อสร้างหน้าใหม่เสร็จ ให้เปลี่ยน ready: false เป็น true ของหน้านั้นใน PAGES (เมนูและปุ่มในหน้าหลักจะกดได้ทันที)

const AdminLayout = (() => {
    // เมนูทั้งหมดของ Web-Admin (เรียงตามที่แสดงในแถบเมนู)
    const PAGES = [
        { key: 'home',            label: 'หน้าหลัก',                  icon: 'fa-solid fa-house',            href: 'dashboard.html',      ready: true },
        { key: 'approve-found',   label: 'อนุมัติสิ่งของที่พบ',         icon: 'fa-solid fa-box-open',         href: 'approvefound.html',   ready: false },
        { key: 'matches',         label: 'รายการจับคู่สิ่งของ',         icon: 'fa-solid fa-link',             href: 'matches.html',        ready: false },
        { key: 'claims',          label: 'คำขอรับสิ่งของคืน',           icon: 'fa-solid fa-hand-holding',     href: 'claims.html',         ready: false },
        { key: 'record-found',    label: 'บันทึกรายการสิ่งของที่พบ',     icon: 'fa-solid fa-plus',             href: 'recordfound.html',    ready: false },
        // กลุ่ม History
        { key: 'history-lost',    label: 'รายการสิ่งของที่หาย',         icon: 'fa-solid fa-magnifying-glass', href: 'historylost.html',    ready: false, group: 'history' },
        { key: 'history-found',   label: 'รายการสิ่งของที่พบ',          icon: 'fa-solid fa-box',              href: 'historyfound.html',   ready: false, group: 'history' },
        { key: 'history-matches', label: 'รายการจับคู่สิ่งของ',         icon: 'fa-solid fa-link',             href: 'historymatches.html', ready: false, group: 'history' },
        { key: 'history-claims',  label: 'รายการการขอรับสิ่งของคืน',     icon: 'fa-solid fa-hand-holding',     href: 'historyclaims.html',  ready: false, group: 'history' },
    ];
    const HISTORY_OPEN_KEY = 'adminNavHistoryOpen';

    function getPage(key) {
        return PAGES.find((page) => page.key === key) || null;
    }

    function escapeHtml(text) {
        return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // เมนู 1 รายการ: หน้าที่พร้อมใช้เป็นลิงก์, หน้าที่ยังไม่สร้างเป็นข้อความจาง ๆ กดไม่ได้
    function navItemHtml(page, activeKey) {
        const isActive = page.key === activeKey;
        const inner = `<i class="${page.icon}" aria-hidden="true"></i><span class="nav-label">${escapeHtml(page.label)}</span>`
            + `<span class="nav-badge" data-badge="${page.key}" hidden></span>`;
        if (page.ready) {
            return `<li><a class="nav-item${isActive ? ' is-active' : ''}" href="${page.href}"${isActive ? ' aria-current="page"' : ''}>${inner}</a></li>`;
        }
        return `<li><span class="nav-item is-disabled" title="เร็ว ๆ นี้" aria-disabled="true">${inner}</span></li>`;
    }

    function readHistoryOpen(activeKey) {
        if (getPage(activeKey)?.group === 'history') return true;  // อยู่ในหน้า History → เปิดกลุ่มไว้เสมอ
        try {
            const saved = localStorage.getItem(HISTORY_OPEN_KEY);
            return saved === null ? true : saved === '1';
        } catch {
            return true;
        }
    }

    function renderSidebar(activeKey) {
        const mainPages = PAGES.filter((page) => !page.group);
        const historyPages = PAGES.filter((page) => page.group === 'history');
        const historyOpen = readHistoryOpen(activeKey);
        const historyActive = historyPages.some((page) => page.key === activeKey);

        document.getElementById('admin-sidebar').innerHTML = `
            <a class="sidebar-brand" href="dashboard.html">
                <img src="logo.png" alt="">
                <div><strong>Campus Lost &amp; Found</strong><span>ระบบผู้ดูแล</span></div>
            </a>
            <nav aria-label="เมนูผู้ดูแลระบบ">
                <ul class="nav-list">
                    ${mainPages.map((page) => navItemHtml(page, activeKey)).join('')}
                    <li>
                        <button type="button" class="nav-item nav-group-toggle${historyActive ? ' is-active' : ''}" id="history-toggle"
                                aria-expanded="${historyOpen}" aria-controls="history-list">
                            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                            <span class="nav-label">History</span>
                            <i class="fa-solid fa-chevron-down chevron" aria-hidden="true"></i>
                        </button>
                        <ul class="nav-sublist" id="history-list"${historyOpen ? '' : ' hidden'}>
                            ${historyPages.map((page) => navItemHtml(page, activeKey)).join('')}
                        </ul>
                    </li>
                </ul>
            </nav>`;

        document.getElementById('history-toggle').addEventListener('click', (event) => {
            const button = event.currentTarget;
            const open = button.getAttribute('aria-expanded') !== 'true';
            button.setAttribute('aria-expanded', String(open));
            document.getElementById('history-list').hidden = !open;
            try { localStorage.setItem(HISTORY_OPEN_KEY, open ? '1' : '0'); } catch { /* ไม่เป็นไร */ }
        });
    }

    function renderTopbar(title, admin) {
        const email = admin?.Admin_email || '';
        document.getElementById('admin-topbar').innerHTML = `
            <button type="button" class="menu-btn" id="menu-btn" aria-label="เปิดเมนู" aria-controls="admin-sidebar" aria-expanded="false">
                <i class="fa-solid fa-bars"></i>
            </button>
            <h1>${escapeHtml(title)}</h1>
            <div class="admin-user">
                <div class="avatar" aria-hidden="true">${escapeHtml(email.charAt(0) || 'A')}</div>
                <div class="text">
                    <div class="admin-user-email" id="admin-email">${escapeHtml(email)}</div>
                    <div class="admin-user-role">ผู้ดูแลระบบ</div>
                </div>
            </div>
            <button type="button" class="logout-btn" id="logout-btn" title="ออกจากระบบ">
                <i class="fa-solid fa-arrow-right-from-bracket"></i><span class="label">ออกจากระบบ</span>
            </button>`;

        document.getElementById('logout-btn').addEventListener('click', () => AdminSession.redirectToLogin('logout'));

        // ปุ่มเมนูบนจอแคบ: เปิด/ปิดแถบเมนูซ้าย
        const menuBtn = document.getElementById('menu-btn');
        const setOpen = (open) => {
            document.body.classList.toggle('nav-open', open);
            menuBtn.setAttribute('aria-expanded', String(open));
        };
        menuBtn.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));
        document.getElementById('admin-backdrop').addEventListener('click', () => setOpen(false));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setOpen(false);
        });
    }

    // เรียกตอนต้นของทุกหน้า: ตรวจการเข้าสู่ระบบ แล้ววาดเมนู คืนค่า session (หรือ null ถ้ากำลังพากลับหน้า login)
    function init(activeKey) {
        const session = AdminSession.requireLogin();
        if (!session) return null;

        const page = getPage(activeKey);
        renderSidebar(activeKey);
        renderTopbar(page ? page.label : '', session.admin);
        document.title = `${page ? page.label : 'Web-Admin'} | Campus Lost & Found Admin`;
        document.body.classList.remove('is-checking');

        // ตรวจกับ Backend อีกชั้นว่า token ยังใช้ได้ (ถ้าไม่ได้ apiFetch จะพากลับหน้า login เอง)
        AdminSession.apiFetch('/api/auth/admin-me')
            .then(({ ok, data }) => {
                if (ok && data.admin) document.getElementById('admin-email').textContent = data.admin.Admin_email;
            })
            .catch(() => { /* เชื่อมต่อไม่ได้หรือหมดอายุ: หน้าของแต่ละหน้าจะแจ้งเตือนเองตอนเรียก API */ });

        return session;
    }

    // แสดงตัวเลขบนเมนู (0 = ซ่อน)
    function setBadge(key, count) {
        const badge = document.querySelector(`[data-badge="${key}"]`);
        if (!badge) return;
        const value = Number(count) || 0;
        badge.textContent = value > 99 ? '99+' : String(value);
        badge.hidden = value <= 0;
    }

    return { PAGES, getPage, init, setBadge, escapeHtml };
})();