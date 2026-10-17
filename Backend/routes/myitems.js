// API สำหรับหน้า "รายการของฉัน" ของผู้ใช้งาน (App-user/myitems.html)
// เปิดใช้ใน server.js ที่ path /api/items:
//   GET /api/items/my?User_ID=12   รายการที่ผู้ใช้งานคนนี้เคยแจ้งไว้ทั้งหมด แยกเป็น 3 กลุ่ม
//     lost   = สิ่งของที่หาย (ตาราง LostItem)
//     found  = สิ่งของที่พบ (ตาราง FoundItem รวมรายการที่ Admin บันทึกแทนผู้ใช้งานคนนี้)
//     claims = คำขอรับสิ่งของคืน (ตาราง Claim) พร้อมข้อมูลสิ่งของที่พบที่ขอรับคืน
// แต่ละกลุ่มเรียงจากรายการล่าสุดก่อน (รหัสมากไปน้อย)
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { expireOverdueFoundItems } = require('../service/foundstatus');
const { checkAndProcessExpiredMatches } = require('../service/matchingService');

function parseUserId(value) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

const LOST_QUERY = `
    SELECT
        l.Lost_ID,
        l.LostItem_name,
        l.Lost_photo,
        l.Lost_description,
        DATE_FORMAT(l.Lost_date, '%Y-%m-%d') AS Lost_date,
        TIME_FORMAT(l.Lost_time, '%H:%i') AS Lost_time,
        l.Category_ID,
        c.Category_name,
        l.Location_ID,
        loc.Location_name,
        l.Lost_status
    FROM LostItem l
    LEFT JOIN Category c ON l.Category_ID = c.Category_ID
    LEFT JOIN Location loc ON l.Location_ID = loc.Location_ID
    WHERE l.User_ID = ?
    ORDER BY l.Lost_ID DESC`;

const FOUND_QUERY = `
    SELECT
        f.Found_ID,
        f.FoundItem_name,
        f.Found_photo,
        f.Found_description,
        DATE_FORMAT(f.Found_date, '%Y-%m-%d') AS Found_date,
        TIME_FORMAT(f.Found_time, '%H:%i') AS Found_time,
        f.Category_ID,
        c.Category_name,
        f.Location_ID,
        loc.Location_name,
        f.Found_status
    FROM FoundItem f
    LEFT JOIN Category c ON f.Category_ID = c.Category_ID
    LEFT JOIN Location loc ON f.Location_ID = loc.Location_ID
    WHERE f.User_ID = ?
    ORDER BY f.Found_ID DESC`;

// คำขอรับคืน: แสดงข้อมูลของ "สิ่งของที่พบ" ที่ผู้ใช้งานขอรับคืน (ชื่อ รูป หมวดหมู่ สถานที่ที่พบ)
// และแนบรหัส/ชื่อรายการสิ่งของที่หายของผู้ใช้งานที่ใช้จับคู่ไว้ด้วย
const CLAIM_QUERY = `
    SELECT
        cl.Claim_ID,
        cl.Match_ID,
        cl.Lost_ID,
        l.LostItem_name,
        cl.Found_ID,
        f.FoundItem_name,
        f.Found_photo,
        f.Found_description,
        DATE_FORMAT(f.Found_date, '%Y-%m-%d') AS Found_date,
        TIME_FORMAT(f.Found_time, '%H:%i') AS Found_time,
        f.Category_ID,
        c.Category_name,
        f.Location_ID,
        loc.Location_name,
        DATE_FORMAT(cl.Claim_date, '%Y-%m-%d') AS Claim_date,
        cl.Claim_status
    FROM Claim cl
    LEFT JOIN FoundItem f ON cl.Found_ID = f.Found_ID
    LEFT JOIN LostItem l ON cl.Lost_ID = l.Lost_ID
    LEFT JOIN Category c ON f.Category_ID = c.Category_ID
    LEFT JOIN Location loc ON f.Location_ID = loc.Location_ID
    WHERE cl.User_ID = ?
    ORDER BY cl.Claim_ID DESC`;

// GET /api/items/my?User_ID=12
// 200 = { lost: [...], found: [...], claims: [...], counts: { lost, found, claims } }
// 400 = User_ID ไม่ถูกต้อง, 404 = ไม่พบบัญชีผู้ใช้ (code: USER_NOT_FOUND)
router.get('/my', async (req, res) => {
    const userId = parseUserId(req.query.User_ID);
    if (!userId) {
        return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่' });
    }

    try {
        const [[user]] = await db.query('SELECT User_ID FROM User WHERE User_ID = ?', [userId]);
        if (!user) {
            return res.status(404).json({
                success: false,
                code: 'USER_NOT_FOUND',
                message: 'ไม่พบบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่อีกครั้ง'
            });
        }

        // ให้สถานะเป็นปัจจุบันก่อนแสดง (สิ่งของที่พบเกิน 30 นาที / รายการจับคู่ที่เกิน 24 ชม.)
        await expireOverdueFoundItems();
        await checkAndProcessExpiredMatches();

        const [[lost], [found], [claims]] = await Promise.all([
            db.query(LOST_QUERY, [userId]),
            db.query(FOUND_QUERY, [userId]),
            db.query(CLAIM_QUERY, [userId]),
        ]);

        res.json({
            success: true,
            lost,
            found,
            claims,
            counts: { lost: lost.length, found: found.length, claims: claims.length }
        });
    } catch (error) {
        console.error('My Items Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายการของฉัน' });
    }
});

module.exports = router;