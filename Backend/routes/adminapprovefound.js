// API หน้า "อนุมัติสิ่งของที่พบ" ของ Web-Admin (Web-Admin/approvefound.html)
// ต้องเข้าสู่ระบบ Admin ก่อน: ส่ง header Authorization: Bearer <token> (Admin_ID ดึงจาก token ไม่รับจากหน้าเว็บ)
// เปิดใช้ใน server.js ที่ path /api/admin:
//   GET /api/admin/pendingfound          รายการสิ่งของที่พบที่ 'รอการอนุมัติ' (เรียงรหัสจากน้อยไปมาก = แจ้งก่อนอยู่บน)
//   PUT /api/admin/approvefound/:id      อนุมัติ → 'อนุมัติแล้ว' + แจ้งเตือนผู้ใช้ + เริ่มจับคู่กับของหาย
//   PUT /api/admin/rejectfound/:id       ปฏิเสธ → 'ถูกปฏิเสธ' + แจ้งเตือนผู้ใช้ (ไม่ลบข้อมูล)
// รายการที่แจ้งเกิน 30 นาทีแล้วจะถูกปฏิเสธอัตโนมัติก่อนทุกครั้ง (service/foundstatus.js) และหายไปจากรายการที่รออนุมัติ
// Admin ดูรายการเหล่านั้นได้ที่ History › รายการสิ่งของที่พบ (GET /api/admin/history/found) สถานะเป็น 'ถูกปฏิเสธ'
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../utils/admintoken');
const { processMatchingByFoundItem } = require('../service/matchingservice');
const {
    FOUND_EXPIRE_MINUTES,
    MESSAGES,
    markAdminNotificationsRead,
    expireOverdueFoundItems,
} = require('../service/foundstatus');

function parseFoundId(value) {
    const text = String(value || '');
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// 1. รายการที่รอการอนุมัติ
// 200 = { items: [{ Found_ID, Student_ID, Category_ID, Category_name, Location_ID, Location_name, FoundItem_name,
//                   Found_date, Found_time, Found_description, Found_photo, Reported_at, Deliver_by, Minutes_left }],
//         total, expireMinutes, serverTime }
router.get('/pendingfound', requireAdmin, async (req, res) => {
    try {
        await expireOverdueFoundItems();
        const [items] = await db.query(
            `SELECT
                f.Found_ID,
                u.Student_ID,
                f.Category_ID,
                c.Category_name,
                f.Location_ID,
                l.Location_name,
                f.FoundItem_name,
                DATE_FORMAT(f.Found_date, '%Y-%m-%d') AS Found_date,
                TIME_FORMAT(f.Found_time, '%H:%i') AS Found_time,
                f.Found_description,
                f.Found_photo,
                DATE_FORMAT(f.Foundcheck_at, '%Y-%m-%d %H:%i:%s') AS Reported_at,
                DATE_FORMAT(f.Foundcheck_at + INTERVAL ? MINUTE, '%Y-%m-%d %H:%i:%s') AS Deliver_by,
                GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), f.Foundcheck_at + INTERVAL ? MINUTE)) AS Seconds_left
             FROM FoundItem f
             LEFT JOIN User u ON f.User_ID = u.User_ID
             LEFT JOIN Category c ON f.Category_ID = c.Category_ID
             LEFT JOIN Location l ON f.Location_ID = l.Location_ID
             WHERE f.Found_status = 'รอการอนุมัติ'
             ORDER BY f.Found_ID ASC`,
            [FOUND_EXPIRE_MINUTES, FOUND_EXPIRE_MINUTES]
        );
        const [[{ now }]] = await db.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now");

        res.json({
            success: true,
            items: items.map((item) => ({ ...item, Seconds_left: Number(item.Seconds_left) })),
            total: items.length,
            expireMinutes: FOUND_EXPIRE_MINUTES,
            serverTime: now
        });
    } catch (error) {
        console.error('Error fetching pending found items:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายการสิ่งของที่รอการอนุมัติ' });
    }
});

// เปลี่ยนสถานะ 'รอการอนุมัติ' → newStatus แล้วแจ้งเตือนผู้ใช้ (ใช้ร่วมกันทั้งอนุมัติและปฏิเสธ)
async function decide(req, res, { newStatus, message, doneText }) {
    const foundId = parseFoundId(req.params.id);
    if (!foundId) {
        return res.status(400).json({ success: false, message: 'รหัสสิ่งของไม่ถูกต้อง' });
    }

    let conn;
    try {
        await expireOverdueFoundItems();   // ถ้าเกิน 30 นาทีแล้ว รายการจะถูกปฏิเสธอัตโนมัติก่อน
        conn = await db.getConnection();
        await conn.beginTransaction();

        const [[item]] = await conn.query(
            'SELECT Found_ID, User_ID, FoundItem_name, Found_status FROM FoundItem WHERE Found_ID = ? FOR UPDATE',
            [foundId]
        );
        if (!item) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบรายการสิ่งของนี้' });
        }
        if (item.Found_status !== 'รอการอนุมัติ') {
            await conn.rollback();
            return res.status(409).json({
                success: false,
                code: 'NOT_PENDING',
                Found_status: item.Found_status,
                message: item.Found_status === 'ถูกปฏิเสธ'
                    ? `รายการนี้ถูกปฏิเสธแล้ว (อาจเกิน ${FOUND_EXPIRE_MINUTES} นาทีโดยไม่ได้นำสิ่งของมาส่ง) ดูรายการได้ที่ History › รายการสิ่งของที่พบ`
                    : `รายการนี้ถูกดำเนินการไปแล้ว (สถานะ: ${item.Found_status})`
            });
        }

        await conn.query(
            'UPDATE FoundItem SET Found_status = ?, Admin_ID = ? WHERE Found_ID = ?',
            [newStatus, req.admin.Admin_ID, foundId]
        );
        // ทุกครั้งที่สถานะเปลี่ยน ต้องแจ้งเตือนผู้ใช้งานที่แจ้งพบ
        await conn.query(
            'INSERT INTO Notification (User_ID, Found_ID, Message) VALUES (?, ?, ?)',
            [item.User_ID, foundId, message(item.FoundItem_name)]
        );
        await markAdminNotificationsRead(conn, [foundId]);
        await conn.commit();

        if (newStatus === 'อนุมัติแล้ว') processMatchingByFoundItem(foundId);   // เริ่มจับคู่กับของหายในระบบ (ทำเบื้องหลัง)

        res.json({ success: true, message: doneText, Found_ID: foundId, Found_status: newStatus });
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error(`Error setting found item ${foundId} to ${newStatus}:`, error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ กรุณาลองใหม่อีกครั้ง' });
    } finally {
        if (conn) conn.release();
    }
}

// 2. อนุมัติ
router.put('/approvefound/:id', requireAdmin, (req, res) => decide(req, res, {
    newStatus: 'อนุมัติแล้ว',
    message: MESSAGES.approved,
    doneText: 'อนุมัติสิ่งของที่พบเรียบร้อยแล้ว',
}));

// 3. ปฏิเสธ
router.put('/rejectfound/:id', requireAdmin, (req, res) => decide(req, res, {
    newStatus: 'ถูกปฏิเสธ',
    message: MESSAGES.rejected,
    doneText: 'ปฏิเสธรายการสิ่งของที่พบเรียบร้อยแล้ว',
}));

module.exports = router;