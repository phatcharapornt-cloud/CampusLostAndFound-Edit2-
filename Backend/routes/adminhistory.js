// API สำหรับหน้า History ของ Web-Admin (ต้องเข้าสู่ระบบ Admin ก่อน: ส่ง header Authorization: Bearer <token>)
// เปิดใช้ใน server.js ที่ path /api/admin:
//   GET /api/admin/history/lost   5.1 รายการสิ่งของที่หายที่ผู้ใช้งานแจ้งไว้ (หน้า Web-Admin/historylost.html)
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../utils/admintoken');

// สถานะทั้งหมดของสิ่งของที่หาย (ตรงกับ ENUM ของคอลัมน์ LostItem.Lost_status)
const LOST_STATUSES = ['ไม่พบ', 'พบ', 'ได้รับสิ่งของคืนแล้ว', 'ยกเลิกรายการ'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SEARCH_MAX_LENGTH = 100;

function positiveInt(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

// ใช้กับ LIKE: กันไม่ให้ % และ _ ในคำค้นกลายเป็นตัวแทนอักขระ
function escapeLike(text) {
    return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// GET /api/admin/history/lost?status=ไม่พบ&q=กระเป๋า&page=1&pageSize=20
//   status   = กรองตามสถานะ (ไม่ใส่ = ทุกสถานะ)
//   q        = ค้นหาจากรหัสสิ่งของ (Lost_ID), รหัสนักศึกษา, ชื่อสิ่งของ หรือรายละเอียด
//   page     = หน้าที่ต้องการ (เริ่มที่ 1), pageSize = จำนวนต่อหน้า (สูงสุด 100)
// 200 = { items: [...], total, page, pageSize, totalPages, statusCounts: { 'ไม่พบ': n, ... } }
//   เรียงจากรายการที่แจ้งล่าสุดก่อน (Lost_ID มากไปน้อย)
router.get('/history/lost', requireAdmin, async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pageSize = Math.min(positiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const requestedPage = positiveInt(req.query.page, 1);

    if (status && !LOST_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: 'สถานะที่เลือกไม่ถูกต้อง' });
    }
    if (q.length > SEARCH_MAX_LENGTH) {
        return res.status(400).json({ success: false, message: `คำค้นหาต้องไม่เกิน ${SEARCH_MAX_LENGTH} ตัวอักษร` });
    }

    // เงื่อนไขค้นหา (ใช้ทั้งตอนนับจำนวนแต่ละสถานะ และตอนดึงรายการ)
    const searchWhere = [];
    const searchParams = [];
    if (q) {
        const like = `%${escapeLike(q)}%`;
        const idPart = /^\d+$/.test(q) ? 'l.Lost_ID = ? OR ' : '';
        searchWhere.push(`(${idPart}u.Student_ID LIKE ? OR l.LostItem_name LIKE ? OR l.Lost_description LIKE ?)`);
        if (idPart) searchParams.push(Number(q));
        searchParams.push(`${escapeLike(q)}%`, like, like);
    }

    const FROM = `
        FROM LostItem l
        JOIN User u ON l.User_ID = u.User_ID
        LEFT JOIN Category c ON l.Category_ID = c.Category_ID
        LEFT JOIN Location loc ON l.Location_ID = loc.Location_ID`;

    try {
        // จำนวนรายการแต่ละสถานะ (ตามคำค้นหา) สำหรับแท็บกรองสถานะ
        const [countRows] = await db.query(
            `SELECT l.Lost_status AS status, COUNT(*) AS count ${FROM}
             ${searchWhere.length ? `WHERE ${searchWhere.join(' AND ')}` : ''}
             GROUP BY l.Lost_status`,
            searchParams
        );
        const statusCounts = Object.fromEntries(LOST_STATUSES.map((s) => [s, 0]));
        for (const row of countRows) statusCounts[row.status] = Number(row.count);

        const total = status ? statusCounts[status] || 0 : Object.values(statusCounts).reduce((a, b) => a + b, 0);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(requestedPage, totalPages);

        const where = [...searchWhere];
        const params = [...searchParams];
        if (status) {
            where.push('l.Lost_status = ?');
            params.push(status);
        }

        const [items] = await db.query(
            `SELECT
                l.Lost_ID,
                u.Student_ID,
                l.Category_ID,
                c.Category_name,
                l.Location_ID,
                loc.Location_name,
                l.LostItem_name,
                DATE_FORMAT(l.Lost_date, '%Y-%m-%d') AS Lost_date,
                TIME_FORMAT(l.Lost_time, '%H:%i') AS Lost_time,
                l.Lost_description,
                l.Lost_photo,
                l.Lost_status
             ${FROM}
             ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY l.Lost_ID DESC
             LIMIT ? OFFSET ?`,
            [...params, pageSize, (page - 1) * pageSize]
        );

        res.json({ success: true, items, total, page, pageSize, totalPages, statusCounts });
    } catch (error) {
        console.error('History Lost Items Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายการสิ่งของที่หาย' });
    }
});

module.exports = router;