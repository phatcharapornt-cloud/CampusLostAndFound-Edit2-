// API สำหรับหน้าหลักของ Web-Admin (ต้องเข้าสู่ระบบ Admin ก่อน: ส่ง header Authorization: Bearer <token>)
// เปิดใช้ใน server.js ที่ path /api/admin:
//   GET /api/admin/summary   จำนวนรายการที่รอดำเนินการ และจำนวนรายการทั้งหมดในแต่ละ History
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../utils/admintoken');

// เงื่อนไขการนับใช้ชุดเดียวกับ API ที่แสดงรายการจริง เพื่อให้ตัวเลขบนหน้าหลักตรงกับจำนวนรายการในแต่ละหน้า
//   pendingFound   = GET /api/admin/pendingfound  (สิ่งของที่พบ สถานะ 'รอการอนุมัติ')
//   pendingMatches = GET /api/match/pending       (คู่ที่ Admin ยังไม่ได้ตรวจสอบ ของหาย 'ไม่พบ' ของที่พบ 'อนุมัติแล้ว')
//   pendingClaims  = GET /api/claim/pending       (คำขอรับคืน สถานะ 'รอการอนุมัติ')
//   awaitingReturn = คำขอที่อนุมัติแล้ว รอเจ้าของมารับสิ่งของ (สถานะ 'อนุมัติ')
const SUMMARY_QUERY = `
    SELECT
        (SELECT COUNT(*) FROM FoundItem WHERE Found_status = 'รอการอนุมัติ') AS pendingFound,

        (SELECT COUNT(*)
           FROM MatchItem m
           JOIN LostItem l  ON m.Lost_ID = l.Lost_ID
           JOIN FoundItem f ON m.Found_ID = f.Found_ID
          WHERE m.Match_status IS NULL
            AND l.Lost_status = 'ไม่พบ'
            AND f.Found_status = 'อนุมัติแล้ว') AS pendingMatches,

        (SELECT COUNT(*) FROM Claim WHERE Claim_status = 'รอการอนุมัติ') AS pendingClaims,
        (SELECT COUNT(*) FROM Claim WHERE Claim_status = 'อนุมัติ') AS awaitingReturn,

        (SELECT COUNT(*) FROM LostItem)  AS totalLost,
        (SELECT COUNT(*) FROM FoundItem) AS totalFound,
        (SELECT COUNT(*) FROM MatchItem) AS totalMatches,
        (SELECT COUNT(*) FROM Claim)     AS totalClaims
`;

// GET /api/admin/summary
// 200 = { pending: { found, matches, claims, awaitingReturn }, totals: { lost, found, matches, claims }, generatedAt }
router.get('/summary', requireAdmin, async (req, res) => {
    try {
        const [[row]] = await db.query(SUMMARY_QUERY);
        res.json({
            success: true,
            pending: {
                found: Number(row.pendingFound),
                matches: Number(row.pendingMatches),
                claims: Number(row.pendingClaims),
                awaitingReturn: Number(row.awaitingReturn),
            },
            totals: {
                lost: Number(row.totalLost),
                found: Number(row.totalFound),
                matches: Number(row.totalMatches),
                claims: Number(row.totalClaims),
            },
            generatedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Admin Summary Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสรุปของหน้าหลัก'
        });
    }
});

module.exports = router;