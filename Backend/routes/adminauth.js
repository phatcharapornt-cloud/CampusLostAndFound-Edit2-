// API เข้าสู่ระบบของผู้ดูแลระบบ (Web-Admin)
// เปิดใช้ใน server.js ที่ path /api/auth:
//   (1) POST /api/auth/admin-login  เข้าสู่ระบบด้วย Admin_email + Admin_password → ได้ token กลับไป
//   (2) GET  /api/auth/admin-me     ตรวจว่า token ยังใช้ได้ (หน้า Web-Admin เรียกตอนเปิดหน้า)
// บัญชี Admin กำหนดไว้ล่วงหน้าในตาราง Admin (ไม่มีหน้าสมัคร) เพิ่มด้วยคำสั่ง SQL ได้เลย (รหัสผ่านเก็บตามที่พิมพ์):
//   INSERT INTO Admin (Admin_email, Admin_password) VALUES ('newadmin@kmitl.ac.th', 'Admin*1234');
// Admin ที่เพิ่มแล้วจะได้รับการแจ้งเตือนของเหตุการณ์ใหม่ทุกอย่างทันที (ระบบส่งให้ Admin ทุกคนที่อยู่ในตารางตอนเกิดเหตุการณ์)
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { validateAdminLogin } = require('../utils/validators');
const { createAdminToken, requireAdmin } = require('../utils/admintoken');
const { safeEqual, verifyPassword } = require('../utils/password');

const MAX_FAILED_LOGINS = 5;              // กรอกรหัสผิดได้ 5 ครั้ง
const LOCK_SECONDS = 5 * 60;              // แล้วล็อกอีเมลนั้นไว้ 5 นาที

// เก็บจำนวนครั้งที่เข้าสู่ระบบผิด แยกตามอีเมล (ในหน่วยความจำ รีเซ็ตเมื่อรีสตาร์ทเซิร์ฟเวอร์)
const failedLogins = new Map();           // Admin_email → { count, lockedUntil }

// ตรวจรหัสผ่าน (เก็บเป็นข้อความตามที่ตั้งไว้ ไม่ hash ดู utils/password.js)
function checkAdminPassword(admin, password) {
    return verifyPassword(password, admin.Admin_password);
}

function secondsUntilUnlock(email) {
    const record = failedLogins.get(email);
    if (!record || !record.lockedUntil) return 0;
    const seconds = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    if (seconds <= 0) {
        failedLogins.delete(email);
        return 0;
    }
    return seconds;
}

function recordFailedLogin(email) {
    const record = failedLogins.get(email) || { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= MAX_FAILED_LOGINS) {
        failedLogins.set(email, { count: 0, lockedUntil: Date.now() + LOCK_SECONDS * 1000 });
        return 0;                              // 0 = เพิ่งถูกล็อก
    }
    failedLogins.set(email, record);
    return MAX_FAILED_LOGINS - record.count;   // จำนวนครั้งที่เหลือก่อนถูกล็อก
}

function lockedResponse(res, seconds) {
    const minutes = Math.ceil(seconds / 60);
    return res.status(429).json({
        success: false,
        code: 'ADMIN_LOCKED',
        message: `กรอกรหัสผ่านผิดหลายครั้งเกินไป กรุณาลองใหม่ในอีก ${minutes} นาที`,
        retryAfterSeconds: seconds
    });
}

// 1. เข้าสู่ระบบผู้ดูแลระบบ (POST /api/auth/admin-login)
// Body: { Admin_email, Admin_password }
// 200 = { role: 'admin', admin: { Admin_ID, Admin_email }, token, expiresAt }
// 400 = กรอกไม่ครบ/อีเมลผิดรูปแบบ | 401 = อีเมลหรือรหัสผ่านไม่ถูกต้อง | 429 = กรอกผิดเกินกำหนด ถูกล็อกชั่วคราว
router.post('/admin-login', async (req, res) => {
    const { values, errors } = validateAdminLogin(req.body ?? {});
    if (Object.keys(errors).length > 0) {
        const missingField = values.Admin_email === '' || values.Admin_password === '';
        return res.status(400).json({
            success: false,
            message: missingField ? 'กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน' : Object.values(errors)[0],
            errors
        });
    }

    const { Admin_email, Admin_password } = values;

    // 1. อีเมลนี้ถูกล็อกอยู่หรือไม่
    const lockedSeconds = secondsUntilUnlock(Admin_email);
    if (lockedSeconds > 0) return lockedResponse(res, lockedSeconds);

    try {
        // 2. ค้นหา Admin จากอีเมล
        const [admins] = await db.query(
            'SELECT Admin_ID, Admin_email, Admin_password FROM Admin WHERE Admin_email = ?',
            [Admin_email]
        );
        const admin = admins[0];

        // 3. ตรวจรหัสผ่าน
        let isPasswordValid = false;
        if (admin) {
            isPasswordValid = await checkAdminPassword(admin, Admin_password);
        } else {
            safeEqual(Admin_password, 'no-such-admin'); // ไม่พบอีเมล: เทียบหลอกไว้ให้ใช้เวลาใกล้เคียงกับกรณีพบ
        }

        if (!isPasswordValid) {
            const attemptsLeft = recordFailedLogin(Admin_email);
            if (attemptsLeft === 0) return lockedResponse(res, LOCK_SECONDS);
            return res.status(401).json({
                success: false,
                message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
                attemptsLeft
            });
        }

        // 4. สำเร็จ: ล้างตัวนับ แล้วออก token ให้หน้าเว็บใช้เรียก API ของ Admin
        failedLogins.delete(Admin_email);
        const { token, expiresAt } = createAdminToken(admin);

        res.status(200).json({
            success: true,
            message: 'เข้าสู่ระบบสำเร็จ',
            role: 'admin',
            admin: { Admin_ID: admin.Admin_ID, Admin_email: admin.Admin_email },
            token,
            expiresAt  // เวลาหมดอายุของ token (Unix timestamp หน่วยวินาที)
        });
    } catch (error) {
        console.error('Admin Login Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบของผู้ดูแลระบบ'
        });
    }
});

// 2. ข้อมูล Admin ที่เข้าสู่ระบบอยู่ (GET /api/auth/admin-me)
// Header: Authorization: Bearer <token>
// 200 = { admin: { Admin_ID, Admin_email } } | 401 = token ไม่ถูกต้อง/หมดอายุ/บัญชีถูกลบ
router.get('/admin-me', requireAdmin, async (req, res) => {
    try {
        const [admins] = await db.query('SELECT Admin_ID, Admin_email FROM Admin WHERE Admin_ID = ?', [req.admin.Admin_ID]);
        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                code: 'ADMIN_UNAUTHORIZED',
                message: 'ไม่พบบัญชีผู้ดูแลระบบนี้แล้ว กรุณาเข้าสู่ระบบใหม่'
            });
        }
        res.json({ success: true, admin: admins[0], expiresAt: req.admin.exp });
    } catch (error) {
        console.error('Admin Me Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์ผู้ดูแลระบบ'
        });
    }
});

module.exports = router;