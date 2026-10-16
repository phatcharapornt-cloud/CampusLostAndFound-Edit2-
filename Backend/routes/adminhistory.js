// API สำหรับหน้า History ของ Web-Admin (ต้องเข้าสู่ระบบ Admin ก่อน: ส่ง header Authorization: Bearer <token>)
// เปิดใช้ใน server.js ที่ path /api/admin:
//   GET /api/admin/history/lost    5.1 รายการสิ่งของที่หายที่ผู้ใช้งานแจ้งไว้ (หน้า Web-Admin/historylost.html)
//   GET /api/admin/history/found   5.2 รายการสิ่งของที่พบทั้งหมด ทุกสถานะ (หน้า Web-Admin/historyfound.html)
//                                      รวมรายการที่ถูกปฏิเสธอัตโนมัติเพราะไม่ได้นำมาส่งภายใน 30 นาที
//   GET /api/admin/history/matches 5.3 รายการจับคู่สิ่งของทั้งหมด ทุกสถานะ (หน้า Web-Admin/historymatches.html)
//                                      สถานะ 'รอการตรวจสอบ' = Admin ยังไม่ได้อนุมัติ/ปฏิเสธ (Match_status เป็น NULL)
//
// query ที่ใช้ได้ทั้งสองแบบ: ?status=...&q=...&page=1&pageSize=20
//   status   = กรองตามสถานะ (ไม่ใส่ = ทุกสถานะ)
//   q        = ค้นหาจากรหัสสิ่งของ (หรือรหัสจับคู่), รหัสนักศึกษา, ชื่อสิ่งของ หรือรายละเอียด
//   page     = หน้าที่ต้องการ (เริ่มที่ 1), pageSize = จำนวนต่อหน้า (สูงสุด 100)
// 200 = { items: [...], total, page, pageSize, totalPages, statusCounts: { สถานะ: จำนวน, ... } }
//   เรียงตามรหัสสิ่งของจากน้อยไปมาก
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../utils/admintoken');
const { expireOverdueFoundItems } = require('../service/foundstatus');
const { checkAndProcessExpiredMatches } = require('../service/matchingService');
const { MATCH_STATUSES, STATUS_SQL, MATCH_FROM, MATCH_COLUMNS, shapeMatchRow } = require('../service/matchquery');

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

// ตั้งค่าของแต่ละหน้า History (ชื่อตาราง/คอลัมน์ต่างกัน แต่วิธีค้นหา กรอง และแบ่งหน้าเหมือนกัน)
const HISTORY = {
    lost: {
        // สถานะทั้งหมด (ตรงกับ ENUM ของคอลัมน์ LostItem.Lost_status)
        statuses: ['ไม่พบ', 'พบ', 'ได้รับสิ่งของคืนแล้ว', 'ยกเลิกรายการ'],
        id: 'x.Lost_ID',
        name: 'x.LostItem_name',
        description: 'x.Lost_description',
        status: 'x.Lost_status',
        from: `
            FROM LostItem x
            JOIN User u ON x.User_ID = u.User_ID
            LEFT JOIN Category c ON x.Category_ID = c.Category_ID
            LEFT JOIN Location loc ON x.Location_ID = loc.Location_ID`,
        columns: `
            x.Lost_ID,
            u.Student_ID,
            x.Category_ID,
            c.Category_name,
            x.Location_ID,
            loc.Location_name,
            x.LostItem_name,
            DATE_FORMAT(x.Lost_date, '%Y-%m-%d') AS Lost_date,
            TIME_FORMAT(x.Lost_time, '%H:%i') AS Lost_time,
            x.Lost_description,
            x.Lost_photo,
            x.Lost_status`,
        errorText: 'เกิดข้อผิดพลาดในการดึงรายการสิ่งของที่หาย',
    },
    found: {
        // สถานะทั้งหมด (ตรงกับ ENUM ของคอลัมน์ FoundItem.Found_status)
        statuses: ['รอการอนุมัติ', 'อนุมัติแล้ว', 'ถูกปฏิเสธ', 'คืนสิ่งของแล้ว'],
        id: 'x.Found_ID',
        name: 'x.FoundItem_name',
        description: 'x.Found_description',
        status: 'x.Found_status',
        from: `
            FROM FoundItem x
            JOIN User u ON x.User_ID = u.User_ID
            LEFT JOIN Category c ON x.Category_ID = c.Category_ID
            LEFT JOIN Location loc ON x.Location_ID = loc.Location_ID
            LEFT JOIN Admin a ON x.Admin_ID = a.Admin_ID`,
        // Handled_by = อีเมล Admin ที่อนุมัติ/ปฏิเสธ (ว่าง + 'ถูกปฏิเสธ' = ระบบปฏิเสธอัตโนมัติเพราะเกิน 30 นาที)
        columns: `
            x.Found_ID,
            u.Student_ID,
            x.Category_ID,
            c.Category_name,
            x.Location_ID,
            loc.Location_name,
            x.FoundItem_name,
            DATE_FORMAT(x.Found_date, '%Y-%m-%d') AS Found_date,
            TIME_FORMAT(x.Found_time, '%H:%i') AS Found_time,
            x.Found_description,
            x.Found_photo,
            x.Found_status,
            DATE_FORMAT(x.Foundcheck_at, '%Y-%m-%d %H:%i:%s') AS Reported_at,
            a.Admin_email AS Handled_by,
            (x.Found_status = 'ถูกปฏิเสธ' AND x.Admin_ID IS NULL) AS Auto_rejected`,
        // ให้สถานะเป็นปัจจุบันก่อนแสดง (รายการที่เกิน 30 นาทีจะกลายเป็น 'ถูกปฏิเสธ')
        before: expireOverdueFoundItems,
        map: (item) => ({ ...item, Auto_rejected: Boolean(item.Auto_rejected) }),
        errorText: 'เกิดข้อผิดพลาดในการดึงรายการสิ่งของที่พบ',
    },
    matches: {
        statuses: MATCH_STATUSES,
        id: 'm.Match_ID',
        status: STATUS_SQL,
        from: MATCH_FROM,
        columns: MATCH_COLUMNS,
        // ค้นหาได้ทั้งรหัสจับคู่ / รหัสสิ่งของที่หายหรือที่พบ, รหัสนักศึกษาของทั้งสองฝั่ง, ชื่อสิ่งของทั้งสองฝั่ง
        search: (q, like, prefix) => {
            const isId = /^\d+$/.test(q);
            return {
                sql: `(${isId ? 'm.Match_ID = ? OR l.Lost_ID = ? OR f.Found_ID = ? OR ' : ''}lu.Student_ID LIKE ? OR fu.Student_ID LIKE ?
                       OR l.LostItem_name LIKE ? OR f.FoundItem_name LIKE ?)`,
                params: [...(isId ? [Number(q), Number(q), Number(q)] : []), prefix, prefix, like, like],
            };
        },
        before: checkAndProcessExpiredMatches,
        map: shapeMatchRow,
        errorText: 'เกิดข้อผิดพลาดในการดึงรายการจับคู่สิ่งของ',
    },
};

function historyHandler(config) {
    return async (req, res) => {
        const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const pageSize = Math.min(positiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
        const requestedPage = positiveInt(req.query.page, 1);

        if (status && !config.statuses.includes(status)) {
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
            const prefix = `${escapeLike(q)}%`;
            if (config.search) {
                const custom = config.search(q, like, prefix);
                searchWhere.push(custom.sql);
                searchParams.push(...custom.params);
            } else {
                const idPart = /^\d+$/.test(q) ? `${config.id} = ? OR ` : '';
                searchWhere.push(`(${idPart}u.Student_ID LIKE ? OR ${config.name} LIKE ? OR ${config.description} LIKE ?)`);
                if (idPart) searchParams.push(Number(q));
                searchParams.push(prefix, like, like);
            }
        }

        try {
            if (config.before) await config.before();

            // จำนวนรายการแต่ละสถานะ (ตามคำค้นหา) สำหรับแท็บกรองสถานะ
            const [countRows] = await db.query(
                `SELECT ${config.status} AS status, COUNT(*) AS count ${config.from}
                 ${searchWhere.length ? `WHERE ${searchWhere.join(' AND ')}` : ''}
                 GROUP BY ${config.status}`,
                searchParams
            );
            const statusCounts = Object.fromEntries(config.statuses.map((s) => [s, 0]));
            for (const row of countRows) statusCounts[row.status] = Number(row.count);

            const total = status ? statusCounts[status] || 0 : Object.values(statusCounts).reduce((a, b) => a + b, 0);
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const page = Math.min(requestedPage, totalPages);

            const where = [...searchWhere];
            const params = [...searchParams];
            if (status) {
                where.push(`${config.status} = ?`);
                params.push(status);
            }

            const [rows] = await db.query(
                `SELECT ${config.columns}
                 ${config.from}
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY ${config.id} ASC
                 LIMIT ? OFFSET ?`,
                [...params, pageSize, (page - 1) * pageSize]
            );
            const items = config.map ? rows.map(config.map) : rows;

            res.json({ success: true, items, total, page, pageSize, totalPages, statusCounts });
        } catch (error) {
            console.error(`History (${config.id}) Error:`, error);
            res.status(500).json({ success: false, message: config.errorText });
        }
    };
}

router.get('/history/lost', requireAdmin, historyHandler(HISTORY.lost));
router.get('/history/found', requireAdmin, historyHandler(HISTORY.found));
router.get('/history/matches', requireAdmin, historyHandler(HISTORY.matches));

module.exports = router;