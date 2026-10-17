// API หน้า "รายการจับคู่สิ่งของ" ของ Web-Admin (Web-Admin/matches.html)
// ต้องเข้าสู่ระบบ Admin ก่อน: ส่ง header Authorization: Bearer <token>
// เปิดใช้ใน server.js ที่ path /api/match:
//   GET  /api/match/pending            คู่ที่รอ Admin ตรวจสอบ (Match Score มากกว่า 70, ของหาย 'ไม่พบ', ของที่พบ 'อนุมัติแล้ว')
//   PUT  /api/match/approve/:matchId   อนุมัติ → แจ้งเตือนผู้ใช้ (+ อีเมลจำลอง ดูได้ใน App-user/mail.html), ของหาย → 'พบ',
//                                      Match_status → 'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน'
//   PUT  /api/match/reject/:matchId    ปฏิเสธ → ไม่แจ้งผู้ใช้, Match_status → 'ปฏิเสธการส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน'
//                                      (ไม่ลบข้อมูล ดูย้อนหลังได้ที่ History › รายการจับคู่สิ่งของ)
//   POST /api/match/run/:lostId        สั่งคำนวณจับคู่ของสิ่งของที่หายรายการนี้ใหม่
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../utils/admintoken');
const {
    formatScore,
    processMatchingByLostItem,
    checkAndProcessExpiredMatches,
} = require('../service/matchingService');
const { MATCH_FROM, MATCH_COLUMNS, shapeMatchRow } = require('../service/matchquery');

const MESSAGE_MAX_LENGTH = 200;   // Notification.Message VARCHAR(200)
const STATUS_SENT = 'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน';
const STATUS_REJECTED = 'ปฏิเสธการส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน';

function parseId(value) {
    const text = String(value || '');
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// ข้อความแจ้งเตือนผู้ใช้ (ตัดชื่อสิ่งของให้สั้นลงถ้ายาวเกิน 200 ตัวอักษรรวมทั้งข้อความ)
function userMatchMessage(lostName, score) {
    const build = (name) => `พบเจอรายการสิ่งของที่คล้ายคลึงกับสิ่งของที่คุณตามหา "${name}" (Match Score ${formatScore(score)}%) สามารถทำการกดดูรายละเอียดได้ในอีเมล`;
    const room = MESSAGE_MAX_LENGTH - build('').length;
    const name = String(lostName);
    return build(name.length > room ? `${name.slice(0, room - 1)}…` : name);
}

// 1. ประมวลผลจับคู่ของสิ่งของที่หายรายการนี้ใหม่ (POST /api/match/run/:lostId)
router.post('/run/:lostId', requireAdmin, async (req, res) => {
    const lostId = parseId(req.params.lostId);
    if (!lostId) return res.status(400).json({ success: false, message: 'รหัสสิ่งของไม่ถูกต้อง' });
    try {
        await checkAndProcessExpiredMatches();
        const created = await processMatchingByLostItem(lostId);
        res.json({ success: true, message: 'ประมวลผลการจับคู่สิ่งของเรียบร้อยแล้ว', created });
    } catch (error) {
        console.error('Error running match:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการประมวลผลจับคู่' });
    }
});

// 2. รายการจับคู่ที่รอ Admin ตรวจสอบ (GET /api/match/pending) เรียงรหัสจับคู่จากน้อยไปมาก
// 200 = { items: [{ Match_ID, Match_score, Match_status, breakdown, lost: {...}, found: {...} }], total }
router.get('/pending', requireAdmin, async (req, res) => {
    try {
        await checkAndProcessExpiredMatches();   // คู่ที่ผู้ใช้ไม่ตอบภายใน 24 ชม. → ของหายกลับเป็น 'ไม่พบ' และจับคู่ใหม่
        const [rows] = await db.query(
            `SELECT ${MATCH_COLUMNS} ${MATCH_FROM}
             WHERE m.Match_status IS NULL AND l.Lost_status = 'ไม่พบ' AND f.Found_status = 'อนุมัติแล้ว'
             ORDER BY m.Match_ID ASC`
        );
        const items = rows.map(shapeMatchRow);
        res.json({ success: true, items, total: items.length });
    } catch (error) {
        console.error('Error fetching pending matches:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายการจับคู่' });
    }
});

// ตรวจและล็อกรายการจับคู่ที่ยังรอตรวจสอบ (ใช้ร่วมกันทั้งอนุมัติ/ปฏิเสธ) คืน { match } หรือ { status, body } ถ้าใช้ไม่ได้
async function lockPendingMatch(conn, matchId) {
    const [[match]] = await conn.query(
        `SELECT m.Match_ID, m.Match_score, m.Match_status, m.Lost_ID, m.Found_ID,
                l.User_ID AS Lost_User_ID, l.LostItem_name, l.Lost_status, f.Found_status
         FROM MatchItem m
         JOIN LostItem l ON m.Lost_ID = l.Lost_ID
         JOIN FoundItem f ON m.Found_ID = f.Found_ID
         WHERE m.Match_ID = ?
         FOR UPDATE`,
        [matchId]
    );
    if (!match) return { status: 404, body: { success: false, message: 'ไม่พบรายการจับคู่นี้' } };
    if (match.Match_status !== null) {
        return { status: 409, body: { success: false, code: 'NOT_PENDING', message: `รายการจับคู่นี้ถูกดำเนินการไปแล้ว (สถานะ: ${match.Match_status})` } };
    }
    if (match.Lost_status !== 'ไม่พบ') {
        return { status: 409, body: { success: false, code: 'LOST_NOT_AVAILABLE', message: `สิ่งของที่หาย #${match.Lost_ID} ไม่ได้อยู่ในสถานะ "ไม่พบ" แล้ว (สถานะ: ${match.Lost_status})` } };
    }
    if (match.Found_status !== 'อนุมัติแล้ว') {
        return { status: 409, body: { success: false, code: 'FOUND_NOT_AVAILABLE', message: `สิ่งของที่พบ #${match.Found_ID} ไม่ได้อยู่ในสถานะ "อนุมัติแล้ว" แล้ว (สถานะ: ${match.Found_status})` } };
    }
    return { match };
}

// การแจ้งเตือน "พบรายการจับคู่ใหม่" ของ Admin สำหรับคู่นี้ ไม่ต้องค้างไว้แล้วเมื่อมีคนจัดการ
function markAdminMatchNotificationsRead(conn, matchId) {
    return conn.query('UPDATE Notification SET Is_read = TRUE WHERE Admin_ID IS NOT NULL AND Match_ID = ? AND Is_read = FALSE', [matchId]);
}

// 3. Admin อนุมัติการจับคู่ → ส่งให้ผู้ใช้งาน (PUT /api/match/approve/:matchId)
router.put('/approve/:matchId', requireAdmin, async (req, res) => {
    const matchId = parseId(req.params.matchId);
    if (!matchId) return res.status(400).json({ success: false, message: 'รหัสรายการจับคู่ไม่ถูกต้อง' });

    let conn;
    let match;
    let notiMessage;
    let recipient;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();
        const result = await lockPendingMatch(conn, matchId);
        if (!result.match) {
            await conn.rollback();
            return res.status(result.status).json(result.body);
        }
        match = result.match;
        notiMessage = userMatchMessage(match.LostItem_name, match.Match_score);
        [[recipient]] = await conn.query('SELECT Email FROM User WHERE User_ID = ?', [match.Lost_User_ID]);

        await conn.query('UPDATE MatchItem SET Match_status = ? WHERE Match_ID = ?', [STATUS_SENT, matchId]);
        await conn.query("UPDATE LostItem SET Lost_status = 'พบ' WHERE Lost_ID = ?", [match.Lost_ID]);
        await conn.query(
            'INSERT INTO Notification (User_ID, Lost_ID, Found_ID, Match_ID, Message) VALUES (?, ?, ?, ?, ?)',
            [match.Lost_User_ID, match.Lost_ID, match.Found_ID, matchId, notiMessage]
        );
        await markAdminMatchNotificationsRead(conn, matchId);
        await conn.commit();
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error('Error approving match:', error);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอนุมัติการจับคู่' });
    } finally {
        if (conn) conn.release();
    }

    res.json({
        success: true,
        message: 'อนุมัติการจับคู่และส่งการแจ้งเตือนไปยังผู้ใช้งานเรียบร้อยแล้ว',
        Match_ID: matchId,
        Match_status: STATUS_SENT,
        notification: { Message: notiMessage },
        // อีเมลจำลอง: ไม่ได้ส่งจริง ผู้ใช้เปิดดูได้จากการแจ้งเตือนในแอป (GET /api/mail/:matchId)
        email: { mock: true, to: recipient ? recipient.Email : null },
    });
});

// 4. Admin ปฏิเสธการจับคู่ (PUT /api/match/reject/:matchId) ไม่แจ้งเตือนผู้ใช้
router.put('/reject/:matchId', requireAdmin, async (req, res) => {
    const matchId = parseId(req.params.matchId);
    if (!matchId) return res.status(400).json({ success: false, message: 'รหัสรายการจับคู่ไม่ถูกต้อง' });

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();
        const [[match]] = await conn.query('SELECT Match_ID, Match_status FROM MatchItem WHERE Match_ID = ? FOR UPDATE', [matchId]);
        if (!match) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบรายการจับคู่นี้' });
        }
        if (match.Match_status !== null) {
            await conn.rollback();
            return res.status(409).json({ success: false, code: 'NOT_PENDING', message: `รายการจับคู่นี้ถูกดำเนินการไปแล้ว (สถานะ: ${match.Match_status})` });
        }
        await conn.query('UPDATE MatchItem SET Match_status = ? WHERE Match_ID = ?', [STATUS_REJECTED, matchId]);
        await markAdminMatchNotificationsRead(conn, matchId);
        await conn.commit();
        res.json({ success: true, message: 'ปฏิเสธการส่งรายการจับคู่สิ่งของเรียบร้อยแล้ว', Match_ID: matchId, Match_status: STATUS_REJECTED });
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error('Error rejecting match:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการปฏิเสธการจับคู่' });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;