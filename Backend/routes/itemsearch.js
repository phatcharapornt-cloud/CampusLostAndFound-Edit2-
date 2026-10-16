// API สำหรับหน้าแรกของผู้ใช้งาน (App-user/home.html): ดูและค้นหาสิ่งของที่พบซึ่งอยู่ในระบบ
// เปิดใช้ใน server.js ที่ path /api/items:
//   (1) GET /api/items/found/recent?limit=10                                      สิ่งของที่พบล่าสุด
//   (2) GET /api/items/found/search?keyword=กระเป๋า&Category_ID=2&Location_ID=6   ค้นหาด้วยชื่อ/หมวดหมู่/สถานที่ เรียงจากตรงมากไปน้อย
// แสดงเฉพาะสิ่งของที่ Admin อนุมัติแล้วและยังไม่ได้คืนเจ้าของ (Found_status = 'อนุมัติแล้ว')
// ไม่ส่งข้อมูลของผู้ที่แจ้งพบกลับไป
const express = require('express');
const router = express.Router();
const db = require('../config/db');

// น้ำหนักคะแนนเดียวกับระบบจับคู่อัตโนมัติ (service/matchingService.js): หมวดหมู่ 30, สถานที่ 25, ชื่อสิ่งของ 30
const CATEGORY_WEIGHT = 30;
const LOCATION_WEIGHT = 25;
const KEYWORD_WEIGHT = 30;
// คำค้นที่เจอแค่ในรายละเอียด (ไม่อยู่ในชื่อ) ได้คะแนนครึ่งหนึ่งของที่เจอในชื่อ
const DESCRIPTION_FACTOR = 0.5;

const DEFAULT_RECENT_LIMIT = 10;
const MAX_LIMIT = 50;
const KEYWORD_MAX_LENGTH = 100;
const MAX_KEYWORD_TOKENS = 8;

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

// ตัดคำค้นเป็นคำ ๆ (รองรับภาษาไทยที่เขียนติดกัน เช่น "กระเป๋าดำ" → ["กระเป๋า", "ดำ"])
const thaiSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('th', { granularity: 'word' })
    : null;

function keywordTokens(keyword) {
    const text = keyword.toLowerCase();
    const words = thaiSegmenter
        ? [...thaiSegmenter.segment(text)].filter((part) => part.isWordLike).map((part) => part.segment)
        : text.split(/\s+/);
    const tokens = [...new Set(words.map((word) => word.trim()).filter((word) => word.length >= 2))];
    // คำค้นสั้นมาก (เช่น 1 ตัวอักษร) ให้ใช้ทั้งคำ
    return (tokens.length ? tokens : [text.trim()]).slice(0, MAX_KEYWORD_TOKENS);
}

// ให้คะแนนคำค้นทีละคำ: อยู่ในชื่อ = 1, อยู่แค่ในรายละเอียด = 0.5, ไม่พบ = 0 แล้วเฉลี่ย (0.0 - 1.0)
// เช่น ค้น "กระเป๋าดำ" กับ "กระเป๋าสตางค์ลายการ์ตูน" → กระเป๋า(1) + ดำ(0) = 0.5
function keywordMatch(tokens, name, description) {
    const nameText = String(name || '').toLowerCase();
    const descText = String(description || '').toLowerCase();
    let total = 0;
    let inName = 0;
    let inDescription = 0;
    for (const token of tokens) {
        if (nameText.includes(token)) {
            total += 1;
            inName++;
        } else if (descText.includes(token)) {
            total += DESCRIPTION_FACTOR;
            inDescription++;
        }
    }
    return { score: total / tokens.length, inName, inDescription };
}

// ใช้กับ LIKE: กันไม่ให้ % และ _ ในคำค้นกลายเป็นตัวแทนอักขระ (MySQL ใช้ \ เป็นตัว escape ของ LIKE อยู่แล้ว)
function escapeLike(text) {
    return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
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

// 2. ค้นหาสิ่งของที่พบ (GET /api/items/found/search?keyword=&Category_ID=&Location_ID=)
// ใส่อย่างน้อย 1 อย่าง รายการที่ตรงอย่างใดอย่างหนึ่งจะแสดง แล้วเรียงตาม matchScore (0-100) จากมากไปน้อย
//   matchScore = คะแนนที่ได้ / คะแนนเต็มของเงื่อนไขที่ผู้ใช้กรอก × 100
//   คะแนนชื่อ: ตัดคำค้นเป็นคำ ๆ แล้วดูว่าแต่ละคำอยู่ในชื่อสิ่งของไหม (ถ้าเจอแค่ในรายละเอียด ได้ครึ่งหนึ่ง)
//   matched = { category, location, name, description } บอกว่าตรงข้อไหนบ้าง
router.get('/found/search', async (req, res) => {
    const categoryId = parseId(req.query.Category_ID);
    const locationId = parseId(req.query.Location_ID);
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';

    if (Number.isNaN(categoryId) || Number.isNaN(locationId)) {
        return res.status(400).json({ success: false, message: 'รูปแบบหมวดหมู่หรือสถานที่ไม่ถูกต้อง' });
    }
    if (keyword.length > KEYWORD_MAX_LENGTH) {
        return res.status(400).json({ success: false, message: `ชื่อสิ่งของต้องไม่เกิน ${KEYWORD_MAX_LENGTH} ตัวอักษร` });
    }
    if (categoryId === null && locationId === null && keyword === '') {
        return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อสิ่งของ หรือเลือกหมวดหมู่/สถานที่อย่างน้อย 1 อย่าง' });
    }

    const tokens = keyword ? keywordTokens(keyword) : [];

    // เงื่อนไขดึงรายการที่ "ตรงอย่างน้อย 1 อย่าง" จากฐานข้อมูล
    const where = [];
    const params = [];
    if (categoryId !== null) { where.push('f.Category_ID = ?'); params.push(categoryId); }
    if (locationId !== null) { where.push('f.Location_ID = ?'); params.push(locationId); }
    for (const token of tokens) {
        where.push('(f.FoundItem_name LIKE ? OR f.Found_description LIKE ?)');
        const pattern = `%${escapeLike(token)}%`;
        params.push(pattern, pattern);
    }

    const maxScore = (categoryId !== null ? CATEGORY_WEIGHT : 0)
        + (locationId !== null ? LOCATION_WEIGHT : 0)
        + (tokens.length ? KEYWORD_WEIGHT : 0);

    try {
        const [rows] = await db.query(
            `SELECT ${FOUND_ITEM_COLUMNS} ${FOUND_ITEM_FROM} AND (${where.join(' OR ')}) ORDER BY ${NEWEST_FIRST}`,
            params
        );

        const items = rows.map((item) => {
            const categoryHit = categoryId !== null && item.Category_ID === categoryId;
            const locationHit = locationId !== null && item.Location_ID === locationId;
            const keywordHit = tokens.length
                ? keywordMatch(tokens, item.FoundItem_name, item.Found_description)
                : { score: 0, inName: 0, inDescription: 0 };

            const score = (categoryHit ? CATEGORY_WEIGHT : 0)
                + (locationHit ? LOCATION_WEIGHT : 0)
                + keywordHit.score * KEYWORD_WEIGHT;

            return {
                ...item,
                matchScore: Math.round((score / maxScore) * 100),
                matched: {
                    category: categoryHit,
                    location: locationHit,
                    name: keywordHit.inName > 0,                                   // มีคำค้นอยู่ในชื่อสิ่งของ
                    description: keywordHit.inName === 0 && keywordHit.inDescription > 0, // เจอแค่ในรายละเอียด
                },
            };
        })
            .filter((item) => item.matchScore > 0)
            // คะแนนมากไปน้อย ถ้าเท่ากันเรียงจากที่พบล่าสุด (rows เรียงล่าสุดก่อนอยู่แล้ว และ sort ของ JS รักษาลำดับเดิม)
            .sort((a, b) => b.matchScore - a.matchScore)
            .slice(0, MAX_LIMIT);

        res.json({ success: true, total: items.length, keywords: tokens, items });
    } catch (error) {
        console.error('Search Found Items Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการค้นหาสิ่งของที่พบ' });
    }
});

module.exports = router;