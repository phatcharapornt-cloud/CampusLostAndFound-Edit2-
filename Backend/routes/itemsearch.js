// API สำหรับหน้าแรกของผู้ใช้งาน (App-user/home.html): ดูและค้นหาสิ่งของที่พบซึ่งอยู่ในระบบ
// เปิดใช้ใน server.js ที่ path /api/items:
//   (1) GET /api/items/found/recent?limit=10                     สิ่งของที่พบล่าสุด
//   (2) GET /api/items/found/search?Category_ID=2&Location_ID=6   ค้นหาตามหมวดหมู่/สถานที่ เรียงจากตรงมากไปน้อย
// แสดงเฉพาะสิ่งของที่ Admin อนุมัติแล้วและยังไม่ได้คืนเจ้าของ (Found_status = 'อนุมัติแล้ว')
// ไม่ส่งข้อมูลของผู้ที่แจ้งพบกลับไป
const express = require('express');
const router = express.Router();
const db = require('../config/db');

// น้ำหนักคะแนนเดียวกับระบบจับคู่อัตโนมัติ (service/matchingService.js): หมวดหมู่ 30, สถานที่ 25
const CATEGORY_WEIGHT = 30;
const LOCATION_WEIGHT = 25;

const DEFAULT_RECENT_LIMIT = 10;
const MAX_LIMIT = 50;

const FOUND_ITEM_COLUMNS = `
    f.Found_ID,
    f.FoundItem_name,
    DATE_FORMAT(f.Found_date, '%Y-%m-%d') AS Found_date,
    TIME_FORMAT(f.Found_time, '%H:%i') AS Found_time,
    f.Found_description,
    f.Found_photo,
    f.Category_ID,
    c.Category_name,
    f.Location_ID,
    l.Location_name`;

const FOUND_ITEM_FROM = `
    FROM FoundItem f
    LEFT JOIN Category c ON f.Category_ID = c.Category_ID
    LEFT JOIN Location l ON f.Location_ID = l.Location_ID
    WHERE f.Found_status = 'อนุมัติแล้ว'`;

const NEWEST_FIRST = 'f.Found_date DESC, f.Found_time DESC, f.Found_ID DESC';

// แปลงค่าที่รับจาก query string เป็นเลขจำนวนเต็มบวก (ว่าง = null, ผิดรูปแบบ = NaN)
function parseId(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : NaN;
}

// 1. สิ่งของที่พบล่าสุด (GET /api/items/found/recent?limit=10)
router.get('/found/recent', async (req, res) => {
    const requested = parseId(req.query.limit);
    const limit = Number.isNaN(requested) || requested === null ? DEFAULT_RECENT_LIMIT : Math.min(requested, MAX_LIMIT);

    try {
        const [items] = await db.query(
            `SELECT ${FOUND_ITEM_COLUMNS} ${FOUND_ITEM_FROM} ORDER BY ${NEWEST_FIRST} LIMIT ?`,
            [limit]
        );
        res.json({ success: true, items });
    } catch (error) {
        console.error('Recent Found Items Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายการสิ่งของที่พบล่าสุด' });
    }
});

// 2. ค้นหาสิ่งของที่พบ (GET /api/items/found/search?Category_ID=&Location_ID=)
// เลือกได้อย่างน้อย 1 อย่าง ผลลัพธ์มี matchScore (0-100) และ matched = { category, location }
//   เลือกทั้งสองอย่าง: ตรงทั้งคู่ 100% → ตรงหมวดหมู่อย่างเดียว 55% → ตรงสถานที่อย่างเดียว 45%
//   เลือกอย่างเดียว: แสดงเฉพาะรายการที่ตรง (100%)
router.get('/found/search', async (req, res) => {
    const categoryId = parseId(req.query.Category_ID);
    const locationId = parseId(req.query.Location_ID);

    if (Number.isNaN(categoryId) || Number.isNaN(locationId)) {
        return res.status(400).json({ success: false, message: 'รูปแบบหมวดหมู่หรือสถานที่ไม่ถูกต้อง' });
    }
    if (categoryId === null && locationId === null) {
        return res.status(400).json({ success: false, message: 'กรุณาเลือกหมวดหมู่หรือสถานที่อย่างน้อย 1 อย่าง' });
    }

    // สร้างเงื่อนไขเฉพาะสิ่งที่ผู้ใช้เลือก
    const conditions = [];
    if (categoryId !== null) conditions.push({ sql: 'f.Category_ID = ?', value: categoryId, weight: CATEGORY_WEIGHT });
    if (locationId !== null) conditions.push({ sql: 'f.Location_ID = ?', value: locationId, weight: LOCATION_WEIGHT });

    const maxScore = conditions.reduce((sum, c) => sum + c.weight, 0);
    const scoreSql = conditions.map((c) => `(${c.sql}) * ${c.weight}`).join(' + ');
    const whereSql = conditions.map((c) => c.sql).join(' OR ');
    const params = [...conditions.map((c) => c.value), ...conditions.map((c) => c.value), MAX_LIMIT];

    try {
        const [rows] = await db.query(
            `SELECT ${FOUND_ITEM_COLUMNS}, (${scoreSql}) AS rawScore
             ${FOUND_ITEM_FROM} AND (${whereSql})
             ORDER BY rawScore DESC, ${NEWEST_FIRST}
             LIMIT ?`,
            params
        );

        const items = rows.map(({ rawScore, ...item }) => ({
            ...item,
            matchScore: Math.round((Number(rawScore) / maxScore) * 100),
            matched: {
                category: categoryId !== null && item.Category_ID === categoryId,
                location: locationId !== null && item.Location_ID === locationId,
            },
        }));

        res.json({ success: true, total: items.length, items });
    } catch (error) {
        console.error('Search Found Items Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการค้นหาสิ่งของที่พบ' });
    }
});

module.exports = router;