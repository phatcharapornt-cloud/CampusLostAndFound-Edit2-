// API ข้อมูลโปรไฟล์ของผู้ใช้งาน (หน้า App-user/profile.html)
// เปิดใช้ใน server.js ที่ path /api/profile:
//   GET /api/profile?User_ID=12   ชื่อ-นามสกุล, รหัสนักศึกษา และอีเมลของผู้ใช้งาน (ไม่ส่งรหัสผ่าน)
// 200 = { user: { User_ID, FName, LName, Student_ID, Email } }
// 400 = ไม่มี User_ID, 404 (code USER_NOT_FOUND) = ไม่พบบัญชี (เช่น ถูกลบไปแล้ว → หน้าเว็บพากลับไปเข้าสู่ระบบใหม่)
const express = require('express');
const router = express.Router();
const db = require('../config/db');

function parseUserId(value) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

router.get('/', async (req, res) => {
    const userId = parseUserId(req.query.User_ID);
    if (!userId) {
        return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่' });
    }
    try {
        const [[user]] = await db.query(
            'SELECT User_ID, FName, LName, Student_ID, Email FROM User WHERE User_ID = ?',
            [userId]
        );
        if (!user) {
            return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
        }
        res.json({ success: true, user });
    } catch (error) {
        console.error('Profile Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลโปรไฟล์' });
    }
});

module.exports = router;