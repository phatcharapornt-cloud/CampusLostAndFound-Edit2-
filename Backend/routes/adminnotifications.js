// API การแจ้งเตือนของ Admin (ไอคอนกระดิ่งบนแถบด้านบนของทุกหน้า Web-Admin)
// ต้องเข้าสู่ระบบ Admin ก่อน: ส่ง header Authorization: Bearer <token>
// เปิดใช้ใน server.js ที่ path /api/admin:
//   GET /api/admin/notifications            การแจ้งเตือนล่าสุด 30 รายการของ Admin คนนี้ + จำนวนที่ยังไม่ได้อ่าน
//   PUT /api/admin/notifications/read-all   ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว
// แต่ละรายการมี Target = หน้าที่เกี่ยวข้อง และ Needs_action = ยังต้องจัดการอยู่หรือไม่
//   Target 'matches'       : "พบรายการจับคู่สิ่งของรายการใหม่" → หน้ารายการจับคู่สิ่งของ (ยังรอตรวจสอบ = Needs_action)
//   Target 'approve-found' : "มีรายการแจ้งสิ่งของที่พบเข้ามาใหม่" → หน้าอนุมัติสิ่งของที่พบ (ยัง 'รอการอนุมัติ' = Needs_action)
//   Target 'claims'        : "มีคำขอการขอรับสิ่งของคืนเข้ามาใหม่" → หน้าคำขอรับสิ่งของคืน (คำขอยัง 'รอการอนุมัติ' = Needs_action)
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
                f.Found_status,
                CASE WHEN n.Claim_ID IS NOT NULL THEN 'claims'
                     WHEN n.Match_ID IS NOT NULL THEN 'matches'
                     WHEN n.Found_ID IS NOT NULL THEN 'approve-found'
                     ELSE NULL END AS Target,
                CASE WHEN n.Claim_ID IS NOT NULL
                         THEN (cl.Claim_status = 'รอการอนุมัติ')
                     WHEN n.Match_ID IS NOT NULL
                         THEN (m.Match_status IS NULL AND ml.Lost_status = 'ไม่พบ' AND mf.Found_status = 'อนุมัติแล้ว' AND ml.User_ID <> mf.User_ID)
                     WHEN n.Found_ID IS NOT NULL
                         THEN (f.Found_status = 'รอการอนุมัติ')
                     ELSE 0 END AS Needs_action
             FROM Notification n
             LEFT JOIN FoundItem f  ON n.Found_ID = f.Found_ID
             LEFT JOIN MatchItem m  ON n.Match_ID = m.Match_ID
             LEFT JOIN LostItem ml  ON m.Lost_ID = ml.Lost_ID
             LEFT JOIN FoundItem mf ON m.Found_ID = mf.Found_ID
             LEFT JOIN Claim cl     ON n.Claim_ID = cl.Claim_ID
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
                Needs_action: Boolean(n.Needs_action),
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