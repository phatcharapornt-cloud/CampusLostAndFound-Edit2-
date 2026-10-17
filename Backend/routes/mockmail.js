// API อีเมลจำลอง (Mockup) ของผู้ใช้งาน: ระบบไม่ได้ส่งอีเมลจริง แต่สร้าง "อีเมล" ให้ดูในแอป (App-user/mail.html)
// อีเมล 1 ฉบับ = รายการจับคู่ 1 รายการที่ Admin อนุมัติส่งให้ผู้ใช้งาน (มีการแจ้งเตือนถึงเจ้าของสิ่งของที่หายแล้ว)
// ไม่ต้องมีตารางเพิ่ม: เนื้อหาอีเมลสร้างจาก MatchItem + LostItem + FoundItem และเวลาส่ง = เวลาของการแจ้งเตือนนั้น
// เปิดใช้ใน server.js ที่ path /api/mail:
//   GET /api/mail?User_ID=12             กล่องจดหมาย: อีเมลทั้งหมดของผู้ใช้ (ใหม่สุดก่อน)
//   GET /api/mail/:matchId?User_ID=12    อีเมล 1 ฉบับ: รายละเอียดสิ่งของที่พบ, Match Score, เวลาที่เหลือสำหรับขอรับคืน
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { CLAIM_WINDOW_HOURS, formatScore, checkAndProcessExpiredMatches } = require('../service/matchingService');
const { MATCH_FROM, MATCH_COLUMNS, shapeMatchRow } = require('../service/matchquery');

const MAIL_FROM = { name: 'Campus Lost & Found', address: 'no-reply@campuslostandfound.local' };
const STATUS_SENT = 'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน';
const STATUS_CONFIRMED = 'ผู้ใช้งานยืนยันการขอรับสิ่งของคืน';

function parseId(value) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// ตรวจ User_ID แล้วคืนข้อมูลผู้ใช้ หรือส่ง error กลับไปเลย (คืน null)
async function requireUser(req, res) {
    const userId = parseId(req.query.User_ID);
    if (!userId) {
        res.status(400).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่' });
        return null;
    }
    const [[user]] = await db.query('SELECT User_ID, FName, LName, Email FROM User WHERE User_ID = ?', [userId]);
    if (!user) {
        res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
        return null;
    }
    return user;
}

// อีเมลของผู้ใช้ = รายการจับคู่ที่มีการแจ้งเตือนถึงเจ้าของสิ่งของที่หาย (เกิดตอน Admin อนุมัติ)
// Sent_at = เวลาแจ้งเตือนครั้งแรก, Seconds_left = เวลาที่เหลือสำหรับส่งคำขอรับคืน (คำนวณจากเวลาของฐานข้อมูล)
const MAIL_SELECT = `
    SELECT ${MATCH_COLUMNS},
           DATE_FORMAT(s.Sent_at, '%Y-%m-%d %H:%i:%s') AS Sent_at,
           DATE_FORMAT(s.Sent_at + INTERVAL ${CLAIM_WINDOW_HOURS} HOUR, '%Y-%m-%d %H:%i:%s') AS Deadline_at,
           GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), s.Sent_at + INTERVAL ${CLAIM_WINDOW_HOURS} HOUR)) AS Seconds_left,
           mc.Claim_ID AS Mail_Claim_ID, mc.Claim_status AS Mail_Claim_status
    ${MATCH_FROM}
    LEFT JOIN Claim mc ON mc.Claim_ID = (SELECT MAX(Claim_ID) FROM Claim WHERE Match_ID = m.Match_ID)
    JOIN (SELECT Match_ID, MIN(Notice_at) AS Sent_at
          FROM Notification
          WHERE User_ID = ? AND Match_ID IS NOT NULL
          GROUP BY Match_ID) s ON s.Match_ID = m.Match_ID
    WHERE l.User_ID = ?`;

function subjectOf(match) {
    return `พบสิ่งของที่คล้ายกับ "${match.lost.LostItem_name}" ที่คุณตามหา (Match Score ${formatScore(match.Match_score)}%)`;
}

// สถานะของอีเมลสำหรับแสดงในแอป
//   waiting   = ยังส่งคำขอรับคืนได้ (ภายใน 24 ชม.)
//   confirmed = ผู้ใช้ส่งคำขอรับสิ่งของคืนแล้ว
//   closed    = เกิน 24 ชม. หรือผู้ใช้ปฏิเสธ (ระบบค้นหาสิ่งของให้ใหม่แล้ว)
function stateOf(match, secondsLeft) {
    if (match.Match_status === STATUS_CONFIRMED) return 'confirmed';
    if (match.Match_status === STATUS_SENT && secondsLeft > 0) return 'waiting';
    return 'closed';
}

function shapeMail(row, user) {
    const match = shapeMatchRow(row);
    delete match.found.Student_ID;   // ไม่ส่งรหัสนักศึกษาของผู้แจ้งพบให้เจ้าของสิ่งของ (ข้อมูลส่วนตัวของคนอื่น)
    const secondsLeft = Number(row.Seconds_left);
    return {
        Match_ID: match.Match_ID,
        From: MAIL_FROM,
        To: { name: `${user.FName} ${user.LName}`.trim(), address: user.Email },
        Subject: subjectOf(match),
        Sent_at: row.Sent_at,
        Deadline_at: row.Deadline_at,
        Seconds_left: secondsLeft,
        Claim_window_hours: CLAIM_WINDOW_HOURS,
        State: stateOf(match, secondsLeft),
        // คำขอรับสิ่งของคืนของรายการนี้ (ถ้ากดขอรับคืนแล้ว) ใช้แสดงสถานะล่าสุดในอีเมล
        Claim: row.Mail_Claim_ID ? { Claim_ID: row.Mail_Claim_ID, Claim_status: row.Mail_Claim_status } : null,
        match,
    };
}

// 1. กล่องจดหมาย (ใหม่สุดก่อน)
router.get('/', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        await checkAndProcessExpiredMatches();   // อัปเดตรายการที่เกิน 24 ชม. ก่อน เพื่อให้สถานะตรงกับปัจจุบัน
        const [rows] = await db.query(`${MAIL_SELECT} ORDER BY s.Sent_at DESC, m.Match_ID DESC`, [user.User_ID, user.User_ID]);
        const emails = rows.map((row) => shapeMail(row, user));
        res.json({ success: true, emails, total: emails.length, waiting: emails.filter((e) => e.State === 'waiting').length });
    } catch (error) {
        console.error('Mock Mail List Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงอีเมล' });
    }
});

// 2. อีเมล 1 ฉบับ (เฉพาะของผู้ใช้คนนั้น)
router.get('/:matchId', async (req, res) => {
    try {
        const matchId = parseId(req.params.matchId);
        if (!matchId) return res.status(400).json({ success: false, message: 'รหัสอีเมลไม่ถูกต้อง' });
        const user = await requireUser(req, res);
        if (!user) return;
        await checkAndProcessExpiredMatches();
        const [[row]] = await db.query(`${MAIL_SELECT} AND m.Match_ID = ?`, [user.User_ID, user.User_ID, matchId]);
        if (!row) return res.status(404).json({ success: false, message: 'ไม่พบอีเมลนี้' });
        res.json({ success: true, email: shapeMail(row, user) });
    } catch (error) {
        console.error('Mock Mail Detail Error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงอีเมล' });
    }
});

module.exports = router;