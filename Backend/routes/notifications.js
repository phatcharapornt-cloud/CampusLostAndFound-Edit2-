// API การแจ้งเตือนของผู้ใช้งาน (ข้อมูลจากตาราง Notification ที่ระบบบันทึกไว้ เช่น แจ้งของหายสำเร็จ, พบสิ่งของที่ตรงกัน)
// เปิดใช้ใน server.js ที่ path /api/notifications:
//   GET /api/notifications/unread-count?User_ID=12   จำนวนที่ยังไม่ได้อ่าน (ใช้แสดงตัวเลขบนไอคอนกระดิ่งหน้าแรก)
//   GET /api/notifications?User_ID=12                รายการแจ้งเตือนล่าสุด 50 รายการ (ใหม่สุดก่อน)
//   PUT /api/notifications/read-all  body: { User_ID } ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว (เรียกตอนเปิดหน้าการแจ้งเตือน)
// แสดงเฉพาะการแจ้งเตือนของผู้ใช้งานคนนั้น (ไม่รวมการแจ้งเตือนของ Admin)
const express = require('express');
const router = express.Router();
const db = require('../config/db');

const LIST_LIMIT = 50;

function parseUserId(value) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// ตรวจ User_ID แล้วคืนค่าเลข หรือส่ง error กลับไปเลย (คืน null)
async function requireUser(req, res, value) {
    const userId = parseUserId(value);
    if (!userId) {
        res.status(400).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่' });
        return null;
    }
    const [[user]] = await db.query('SELECT User_ID FROM User WHERE User_ID = ?', [userId]);
    if (!user) {
        res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
        return null;
    }
    return userId;
}

async function countUnread(userId) {
    const [[row]] = await db.query('SELECT COUNT(*) AS unread FROM Notification WHERE User_ID = ? AND Is_read = FALSE', [userId]);
    return Number(row.unread);
}

// 1. จำนวนที่ยังไม่ได้อ่าน
router.get('/unread-count', async (req, res) => {
    try {
        const userId = await requireUser(req, res, req.query.User_ID);
        if (!userId) return;
        res.json({ success: true, unread: await countUnread(userId) });
    } catch (error) {
        console.error('Notification Count Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงจำนวนการแจ้งเตือน' });
    }
});

// 2. รายการแจ้งเตือน
// 200 = { notifications: [{ Notification_ID, Message, Is_read, Notice_at: 'YYYY-MM-DD HH:MM:SS', Lost_ID, Found_ID, Match_ID, Claim_ID }], unread, total }
router.get('/', async (req, res) => {
    try {
        const userId = await requireUser(req, res, req.query.User_ID);
        if (!userId) return;

        const [notifications] = await db.query(
            `SELECT
                Notification_ID,
                Message,
                Is_read,
                DATE_FORMAT(Notice_at, '%Y-%m-%d %H:%i:%s') AS Notice_at,
                Lost_ID,
                Found_ID,
                Match_ID,
                Claim_ID
             FROM Notification
             WHERE User_ID = ?
             ORDER BY Notice_at DESC, Notification_ID DESC
             LIMIT ?`,
            [userId, LIST_LIMIT]
        );
        const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM Notification WHERE User_ID = ?', [userId]);

        res.json({
            success: true,
            notifications: notifications.map((n) => ({ ...n, Is_read: Boolean(n.Is_read) })),
            unread: await countUnread(userId),
            total: Number(total)
        });
    } catch (error) {
        console.error('Notification List Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายการแจ้งเตือน' });
    }
});

// 3. อ่านทั้งหมดแล้ว
router.put('/read-all', async (req, res) => {
    try {
        const userId = await requireUser(req, res, (req.body || {}).User_ID);
        if (!userId) return;
        const [result] = await db.query('UPDATE Notification SET Is_read = TRUE WHERE User_ID = ? AND Is_read = FALSE', [userId]);
        res.json({ success: true, updated: result.affectedRows, unread: 0 });
    } catch (error) {
        console.error('Notification Read-All Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตการแจ้งเตือน' });
    }
});

module.exports = router;