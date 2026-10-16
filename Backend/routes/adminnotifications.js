// API การแจ้งเตือนของ Admin (ไอคอนกระดิ่งบนแถบด้านบนของทุกหน้า Web-Admin)
// ต้องเข้าสู่ระบบ Admin ก่อน: ส่ง header Authorization: Bearer <token>
// เปิดใช้ใน server.js ที่ path /api/admin:
//   GET /api/admin/notifications            การแจ้งเตือนล่าสุด 30 รายการของ Admin คนนี้ + จำนวนที่ยังไม่ได้อ่าน
//   PUT /api/admin/notifications/read-all   ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว
// รายการที่มี Found_ID และสิ่งของยัง 'รอการอนุมัติ' จะมี Needs_action = true (หน้าเว็บพาไปหน้าอนุมัติสิ่งของที่พบ)
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../utils/admintoken');

const LIST_LIMIT = 30;

router.get('/notifications', requireAdmin, async (req, res) => {
    try {
        const adminId = req.admin.Admin_ID;
        const [notifications] = await db.query(
            `SELECT
                n.Notification_ID,
                n.Message,
                n.Is_read,
                DATE_FORMAT(n.Notice_at, '%Y-%m-%d %H:%i:%s') AS Notice_at,
                n.Found_ID,
                n.Lost_ID,
                n.Match_ID,
                n.Claim_ID,
                f.Found_status
             FROM Notification n
             LEFT JOIN FoundItem f ON n.Found_ID = f.Found_ID
             WHERE n.Admin_ID = ?
             ORDER BY n.Notice_at DESC, n.Notification_ID DESC
             LIMIT ?`,
            [adminId, LIST_LIMIT]
        );
        const [[{ unread }]] = await db.query(
            'SELECT COUNT(*) AS unread FROM Notification WHERE Admin_ID = ? AND Is_read = FALSE',
            [adminId]
        );
        res.json({
            success: true,
            notifications: notifications.map((n) => ({
                ...n,
                Is_read: Boolean(n.Is_read),
                Needs_action: n.Found_status === 'รอการอนุมัติ',
            })),
            unread: Number(unread)
        });
    } catch (error) {
        console.error('Admin Notifications Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงการแจ้งเตือน' });
    }
});

router.put('/notifications/read-all', requireAdmin, async (req, res) => {
    try {
        const [result] = await db.query(
            'UPDATE Notification SET Is_read = TRUE WHERE Admin_ID = ? AND Is_read = FALSE',
            [req.admin.Admin_ID]
        );
        res.json({ success: true, updated: result.affectedRows, unread: 0 });
    } catch (error) {
        console.error('Admin Notifications Read-All Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตการแจ้งเตือน' });
    }
});

module.exports = router;