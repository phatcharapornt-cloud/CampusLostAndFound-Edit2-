// API คำขอรับสิ่งของคืน (ตาราง Claim) เปิดใช้ใน server.js ที่ path /api/claim
//
// ฝั่งผู้ใช้งาน (App-user/mail.html: ปุ่ม "ขอรับสิ่งของคืน" ในอีเมลแจ้งรายการจับคู่)
//   POST /api/claim/request   body: { Match_ID, User_ID }
//        ต้องกดภายใน 24 ชม. หลังได้รับแจ้ง → Claim 'รอการอนุมัติ', Match_status 'ผู้ใช้งานยืนยันการขอรับสิ่งของคืน'
//        แจ้งเตือนผู้ใช้ + แจ้งเตือน Admin ทุกคน "มีคำขอการขอรับสิ่งของคืนเข้ามาใหม่"
//        (ถ้าไม่กดภายใน 24 ชม. ระบบจัดการใน service/matchingService.js → checkAndProcessExpiredMatches)
//
// ฝั่ง Admin (Web-Admin/claims.html) ต้องเข้าสู่ระบบ Admin: header Authorization: Bearer <token>
//   GET /api/claim/pending              คำขอที่ยังต้องจัดการ: 'รอการอนุมัติ' และ 'อนุมัติ' (รอเจ้าของมารับ)
//   PUT /api/claim/approve/:claimId     'รอการอนุมัติ' → 'อนุมัติ' แจ้งผู้ใช้ "...ได้รับการอนุมัติแล้ว ให้มารับสิ่งของคืน"
//   PUT /api/claim/reject/:claimId      'รอการอนุมัติ' หรือ 'อนุมัติ' → 'ปฏิเสธ' (ปฏิเสธได้แม้อนุมัติไปแล้ว ถ้ายังไม่ได้คืนสิ่งของ)
//                                       แจ้งผู้ใช้ "...ถูกปฏิเสธ สามารถมาติดต่อได้ที่ส่วนกลาง"
//                                       สิ่งของที่หายกลับเป็น 'ไม่พบ' แล้วจับคู่ใหม่ (ไม่จับกับสิ่งของที่พบคู่เดิม)
//   PUT /api/claim/returned/:claimId    'อนุมัติ' → 'คืนสิ่งของแล้ว' (กดได้หลังอนุมัติเท่านั้น)
//                                       สิ่งของที่หาย 'ได้รับสิ่งของคืนแล้ว', สิ่งของที่พบ 'คืนสิ่งของแล้ว' แจ้งทั้งเจ้าของและผู้แจ้งพบ
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../utils/admintoken');
const { withItemName } = require('../utils/notimessage');
const { notifyAllAdmins } = require('../utils/adminnotify');
const { CLAIM_WINDOW_HOURS, checkAndProcessExpiredMatches, processMatchingByLostItem } = require('../service/matchingService');
const { CLAIM_FROM, CLAIM_COLUMNS, shapeClaimRow } = require('../service/claimquery');

const MATCH_SENT = 'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน';
const MATCH_CONFIRMED = 'ผู้ใช้งานยืนยันการขอรับสิ่งของคืน';
const MATCH_USER_REJECTED = 'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน';

// ข้อความแจ้งเตือน (ไม่เกิน 200 ตัวอักษร: ตัดชื่อสิ่งของให้สั้นลงถ้ายาวเกิน)
const MESSAGES = {
    requested: (name) => withItemName((n) => `ท่านได้ส่งคำขอรับสิ่งของคืน "${n}" เรียบร้อยแล้ว กรุณารอเจ้าหน้าที่ตรวจสอบ`, name),
    adminNew:  (name) => withItemName((n) => `มีคำขอการขอรับสิ่งของคืนเข้ามาใหม่ "${n}"`, name),
    approved:  (name) => withItemName((n) => `รายการคำขอของท่าน "${n}" ได้รับการอนุมัติแล้ว ให้มารับสิ่งของคืน`, name),
    rejected:  (name) => withItemName((n) => `รายการคำขอของท่าน "${n}" ถูกปฏิเสธ สามารถมาติดต่อได้ที่ส่วนกลาง`, name),
    returnedOwner:  (name) => withItemName((n) => `ท่านได้รับสิ่งของ "${n}" คืนเรียบร้อยแล้ว (สถานะ: ได้รับสิ่งของคืนแล้ว)`, name),
    returnedFinder: (name) => withItemName((n) => `สิ่งของที่ท่านแจ้งพบ "${n}" ได้ส่งคืนเจ้าของเรียบร้อยแล้ว ขอบคุณที่ช่วยเหลือ (สถานะ: คืนสิ่งของแล้ว)`, name),
};

function parseId(value) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// ============================================================
// 1. ผู้ใช้งานกด "ขอรับสิ่งของคืน" (POST /api/claim/request)
// 201 = { Claim_ID, Claim_status: 'รอการอนุมัติ', Match_status }
// 400 = ข้อมูลไม่ครบ, 404 = ไม่พบรายการจับคู่ของผู้ใช้นี้
// 409 code: ALREADY_CLAIMED (ส่งคำขอไปแล้ว), EXPIRED (เกิน 24 ชม.), FOUND_NOT_AVAILABLE, LOST_NOT_AVAILABLE
// ============================================================
router.post('/request', async (req, res) => {
    const matchId = parseId((req.body || {}).Match_ID);
    const userId = parseId((req.body || {}).User_ID);
    if (!matchId || !userId) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน กรุณาเปิดอีเมลแล้วกดขอรับสิ่งของคืนอีกครั้ง' });
    }

    let conn;
    let claimId;
    let match;
    try {
        await checkAndProcessExpiredMatches();   // รายการที่เกิน 24 ชม. จะถูกปิดก่อน

        conn = await db.getConnection();
        await conn.beginTransaction();
        [[match]] = await conn.query(
            `SELECT m.Match_ID, m.Match_status, m.Lost_ID, m.Found_ID,
                    l.User_ID, l.LostItem_name, l.Lost_status,
                    f.FoundItem_name, f.Found_status,
                    (SELECT MIN(n.Notice_at) FROM Notification n WHERE n.Match_ID = m.Match_ID AND n.User_ID = l.User_ID) AS Sent_at,
                    (SELECT MIN(n.Notice_at) FROM Notification n WHERE n.Match_ID = m.Match_ID AND n.User_ID = l.User_ID)
                        > NOW() - INTERVAL ? HOUR AS In_window
             FROM MatchItem m
             JOIN LostItem l  ON m.Lost_ID = l.Lost_ID
             JOIN FoundItem f ON m.Found_ID = f.Found_ID
             WHERE m.Match_ID = ?
             FOR UPDATE`,
            [CLAIM_WINDOW_HOURS, matchId]
        );

        const fail = async (status, body) => {
            await conn.rollback();
            res.status(status).json({ success: false, ...body });
        };
        // ต้องเป็นรายการจับคู่ของผู้ใช้คนนี้ และ Admin ส่งให้ผู้ใช้แล้วเท่านั้น
        if (!match || match.User_ID !== userId || match.Sent_at === null) {
            return fail(404, { message: 'ไม่พบรายการจับคู่นี้ในบัญชีของท่าน' });
        }
        if (match.Match_status === MATCH_CONFIRMED) {
            const [[existing]] = await conn.query('SELECT Claim_ID FROM Claim WHERE Match_ID = ? ORDER BY Claim_ID DESC LIMIT 1', [matchId]);
            return fail(409, { code: 'ALREADY_CLAIMED', Claim_ID: existing ? existing.Claim_ID : null, message: 'ท่านได้ส่งคำขอรับสิ่งของคืนสำหรับรายการนี้ไปแล้ว' });
        }
        if (match.Match_status === MATCH_USER_REJECTED || !match.In_window) {
            return fail(409, { code: 'EXPIRED', message: `เกินเวลา ${CLAIM_WINDOW_HOURS} ชั่วโมงแล้ว ไม่สามารถส่งคำขอรับสิ่งของคืนได้ หากต้องการขอรับสิ่งของชิ้นนี้ ให้ติดต่อที่ส่วนกลาง` });
        }
        if (match.Match_status !== MATCH_SENT) {
            return fail(404, { message: 'ไม่พบรายการจับคู่นี้ในบัญชีของท่าน' });
        }
        if (match.Found_status !== 'อนุมัติแล้ว') {
            return fail(409, { code: 'FOUND_NOT_AVAILABLE', message: 'สิ่งของชิ้นนี้ไม่อยู่ในสถานะที่ขอรับคืนได้แล้ว กรุณาติดต่อที่ส่วนกลาง' });
        }
        if (match.Lost_status !== 'พบ') {
            return fail(409, { code: 'LOST_NOT_AVAILABLE', message: `รายการสิ่งของที่หายของท่านอยู่ในสถานะ "${match.Lost_status}" ไม่สามารถขอรับคืนได้` });
        }

        // Claim_detail: สรุปคู่สิ่งของที่ขอรับคืน (รายละเอียดเต็มดึงจากตาราง LostItem/FoundItem ตอนแสดงผล)
        const detail = `สิ่งของที่หาย #${match.Lost_ID} "${match.LostItem_name}" / สิ่งของที่พบ #${match.Found_ID} "${match.FoundItem_name}"`.slice(0, 200);
        const [result] = await conn.query(
            `INSERT INTO Claim (User_ID, Admin_ID, Match_ID, Claim_detail, Claim_status, Claim_date, Claimcheck_at)
             VALUES (?, NULL, ?, ?, 'รอการอนุมัติ', CURDATE(), NULL)`,
            [userId, matchId, detail]
        );
        claimId = result.insertId;
        await conn.query('UPDATE MatchItem SET Match_status = ? WHERE Match_ID = ?', [MATCH_CONFIRMED, matchId]);
        await conn.query(
            'INSERT INTO Notification (User_ID, Lost_ID, Found_ID, Match_ID, Claim_ID, Message) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, match.Lost_ID, match.Found_ID, matchId, claimId, MESSAGES.requested(match.FoundItem_name)]
        );
        await notifyAllAdmins(
            conn,
            { Lost_ID: match.Lost_ID, Found_ID: match.Found_ID, Match_ID: matchId, Claim_ID: claimId },
            MESSAGES.adminNew(match.FoundItem_name)
        );
        await conn.commit();
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error('Error requesting claim:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการส่งคำขอรับสิ่งของคืน กรุณาลองใหม่อีกครั้ง' });
        return;
    } finally {
        if (conn) conn.release();
    }
    if (res.headersSent) return;   // ตอบกลับ error ไปแล้วใน fail()

    res.status(201).json({
        success: true,
        message: 'ส่งคำขอรับสิ่งของคืนเรียบร้อยแล้ว กรุณารอเจ้าหน้าที่ตรวจสอบ',
        Claim_ID: claimId,
        Claim_status: 'รอการอนุมัติ',
        Match_status: MATCH_CONFIRMED,
    });
});

// ============================================================
// 2. คำขอที่ Admin ยังต้องจัดการ (GET /api/claim/pending) เรียงรหัสคำขอจากน้อยไปมาก
// 200 = { items: [{ Claim_ID, Claim_status, claimant, match: { lost, found, ... } }], total, counts: { pending, approved } }
// ============================================================
router.get('/pending', requireAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT ${CLAIM_COLUMNS} ${CLAIM_FROM}
             WHERE c.Claim_status IN ('รอการอนุมัติ', 'อนุมัติ')
             ORDER BY c.Claim_ID ASC`
        );
        const items = rows.map(shapeClaimRow);
        res.json({
            success: true,
            items,
            total: items.length,
            counts: {
                pending: items.filter((i) => i.Claim_status === 'รอการอนุมัติ').length,
                approved: items.filter((i) => i.Claim_status === 'อนุมัติ').length,
            },
        });
    } catch (error) {
        console.error('Error fetching pending claims:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายการคำขอรับสิ่งของคืน' });
    }
});

// ล็อกคำขอ + ข้อมูลที่ต้องใช้ แล้วตรวจสถานะที่ต้องการ (1 สถานะ หรือรายการของสถานะ) คืน { claim } หรือ { status, body }
// ตาราง Claim ไม่เก็บ Lost_ID / Found_ID เอง จึงดึงผ่านรายการจับคู่ (MatchItem) ของคำขอนั้น
async function lockClaim(conn, claimId, expectedStatus) {
    const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    const [[claim]] = await conn.query(
        `SELECT c.Claim_ID, c.Claim_status, c.User_ID, c.Match_ID, m.Lost_ID, m.Found_ID,
                l.LostItem_name, l.Lost_status, f.FoundItem_name, f.Found_status, f.User_ID AS Finder_User_ID
         FROM Claim c
         JOIN MatchItem m ON c.Match_ID = m.Match_ID
         JOIN LostItem l  ON m.Lost_ID = l.Lost_ID
         JOIN FoundItem f ON m.Found_ID = f.Found_ID
         WHERE c.Claim_ID = ?
         FOR UPDATE`,
        [claimId]
    );
    if (!claim) return { status: 404, body: { success: false, message: 'ไม่พบคำขอรับสิ่งของคืนนี้' } };
    if (!allowed.includes(claim.Claim_status)) {
        return {
            status: 409,
            body: { success: false, code: 'WRONG_STATUS', Claim_status: claim.Claim_status, message: `คำขอนี้อยู่ในสถานะ "${claim.Claim_status}" ไม่สามารถทำรายการนี้ได้` },
        };
    }
    return { claim };
}

// การแจ้งเตือน "มีคำขอ...เข้ามาใหม่" ของ Admin สำหรับคำขอนี้ ไม่ต้องค้างไว้แล้วเมื่อมีคนตัดสินแล้ว
function markAdminClaimNotificationsRead(conn, claimId) {
    return conn.query('UPDATE Notification SET Is_read = TRUE WHERE Admin_ID IS NOT NULL AND Claim_ID = ? AND Is_read = FALSE', [claimId]);
}

// รันคำสั่งของ Admin 1 อย่างใน transaction (ใช้ร่วมกันทั้ง อนุมัติ / ปฏิเสธ / คืนสิ่งของแล้ว)
function adminAction(expectedStatus, apply) {
    return async (req, res) => {
        const claimId = parseId(req.params.claimId);
        if (!claimId) return res.status(400).json({ success: false, message: 'รหัสคำขอไม่ถูกต้อง' });
        let conn;
        let outcome;
        try {
            conn = await db.getConnection();
            await conn.beginTransaction();
            const result = await lockClaim(conn, claimId, expectedStatus);
            if (!result.claim) {
                await conn.rollback();
                return res.status(result.status).json(result.body);
            }
            outcome = await apply(conn, result.claim, req.admin.Admin_ID);
            if (outcome.error) {
                await conn.rollback();
                return res.status(outcome.error.status).json({ success: false, ...outcome.error.body });
            }
            await conn.commit();
        } catch (error) {
            if (conn) await conn.rollback().catch(() => {});
            console.error('Claim action error:', error);
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง' });
        } finally {
            if (conn) conn.release();
        }
        if (outcome.after) await outcome.after().catch((error) => console.error('Claim after-action error:', error));
        res.json({ success: true, Claim_ID: claimId, ...outcome.response });
    };
}

// ============================================================
// 3. Admin อนุมัติคำขอ (PUT /api/claim/approve/:claimId)
// ============================================================
router.put('/approve/:claimId', requireAdmin, adminAction('รอการอนุมัติ', async (conn, claim, adminId) => {
    if (claim.Found_status !== 'อนุมัติแล้ว') {
        return { error: { status: 409, body: { code: 'FOUND_NOT_AVAILABLE', message: `สิ่งของที่พบ #${claim.Found_ID} อยู่ในสถานะ "${claim.Found_status}" ไม่สามารถอนุมัติคำขอนี้ได้` } } };
    }
    // สิ่งของชิ้นเดียวกันถูกจับคู่กับของหายได้หลายรายการ: อนุมัติให้ได้ทีละคำขอ (คำขอเดิมต้องคืนสิ่งของหรือถูกปฏิเสธก่อน)
    const [[otherApproved]] = await conn.query(
        `SELECT c.Claim_ID FROM Claim c
         JOIN MatchItem m ON c.Match_ID = m.Match_ID
         WHERE m.Found_ID = ? AND c.Claim_status = 'อนุมัติ' AND c.Claim_ID <> ? LIMIT 1`,
        [claim.Found_ID, claim.Claim_ID]
    );
    if (otherApproved) {
        return { error: { status: 409, body: { code: 'FOUND_ALREADY_APPROVED', message: `สิ่งของที่พบ #${claim.Found_ID} มีคำขอ #${otherApproved.Claim_ID} ที่อนุมัติแล้ว กรุณาจัดการคำขอนั้นก่อน` } } };
    }
    await conn.query("UPDATE Claim SET Claim_status = 'อนุมัติ', Admin_ID = ?, Claimcheck_at = NOW() WHERE Claim_ID = ?", [adminId, claim.Claim_ID]);
    const message = MESSAGES.approved(claim.FoundItem_name);
    await conn.query(
        'INSERT INTO Notification (User_ID, Lost_ID, Found_ID, Match_ID, Claim_ID, Message) VALUES (?, ?, ?, ?, ?, ?)',
        [claim.User_ID, claim.Lost_ID, claim.Found_ID, claim.Match_ID, claim.Claim_ID, message]
    );
    await markAdminClaimNotificationsRead(conn, claim.Claim_ID);
    return { response: { message: 'อนุมัติคำขอรับสิ่งของคืนเรียบร้อยแล้ว', Claim_status: 'อนุมัติ', notification: { Message: message } } };
}));

// ============================================================
// 4. Admin ปฏิเสธคำขอ (PUT /api/claim/reject/:claimId) ได้ทั้งคำขอที่รออนุมัติ และที่อนุมัติแล้วแต่ยังไม่ได้คืนสิ่งของ
//    สิ่งของที่หายกลับเป็น 'ไม่พบ' แล้วจับคู่ใหม่ (คู่เดิมมีอยู่แล้วใน MatchItem จึงไม่ถูกจับซ้ำ)
// ============================================================
router.put('/reject/:claimId', requireAdmin, adminAction(['รอการอนุมัติ', 'อนุมัติ'], async (conn, claim, adminId) => {
    await conn.query("UPDATE Claim SET Claim_status = 'ปฏิเสธ', Admin_ID = ?, Claimcheck_at = NOW() WHERE Claim_ID = ?", [adminId, claim.Claim_ID]);
    await conn.query("UPDATE LostItem SET Lost_status = 'ไม่พบ' WHERE Lost_ID = ? AND Lost_status = 'พบ'", [claim.Lost_ID]);
    const message = MESSAGES.rejected(claim.FoundItem_name);
    await conn.query(
        'INSERT INTO Notification (User_ID, Lost_ID, Found_ID, Match_ID, Claim_ID, Message) VALUES (?, ?, ?, ?, ?, ?)',
        [claim.User_ID, claim.Lost_ID, claim.Found_ID, claim.Match_ID, claim.Claim_ID, message]
    );
    await markAdminClaimNotificationsRead(conn, claim.Claim_ID);
    return {
        response: { message: 'ปฏิเสธคำขอรับสิ่งของคืนเรียบร้อยแล้ว', Claim_status: 'ปฏิเสธ', Lost_status: 'ไม่พบ', notification: { Message: message } },
        after: () => processMatchingByLostItem(claim.Lost_ID),
    };
}));

// ============================================================
// 5. Admin กด "คืนสิ่งของแล้ว" เมื่อเจ้าของมารับสิ่งของ (PUT /api/claim/returned/:claimId) กดได้หลังอนุมัติเท่านั้น
// ============================================================
router.put('/returned/:claimId', requireAdmin, adminAction('อนุมัติ', async (conn, claim, adminId) => {
    if (claim.Found_status !== 'อนุมัติแล้ว') {
        return { error: { status: 409, body: { code: 'FOUND_NOT_AVAILABLE', message: `สิ่งของที่พบ #${claim.Found_ID} อยู่ในสถานะ "${claim.Found_status}" ไม่สามารถบันทึกการคืนได้` } } };
    }
    await conn.query("UPDATE Claim SET Claim_status = 'คืนสิ่งของแล้ว', Admin_ID = ?, Claimcheck_at = NOW() WHERE Claim_ID = ?", [adminId, claim.Claim_ID]);
    await conn.query("UPDATE LostItem SET Lost_status = 'ได้รับสิ่งของคืนแล้ว' WHERE Lost_ID = ?", [claim.Lost_ID]);
    await conn.query("UPDATE FoundItem SET Found_status = 'คืนสิ่งของแล้ว' WHERE Found_ID = ?", [claim.Found_ID]);
    // แจ้งเจ้าของ (สถานะสิ่งของที่หายเปลี่ยน) และผู้แจ้งพบ (สถานะสิ่งของที่พบเปลี่ยน)
    await conn.query(
        'INSERT INTO Notification (User_ID, Lost_ID, Found_ID, Match_ID, Claim_ID, Message) VALUES (?, ?, ?, ?, ?, ?), (?, NULL, ?, NULL, NULL, ?)',
        [
            claim.User_ID, claim.Lost_ID, claim.Found_ID, claim.Match_ID, claim.Claim_ID, MESSAGES.returnedOwner(claim.LostItem_name),
            claim.Finder_User_ID, claim.Found_ID, MESSAGES.returnedFinder(claim.FoundItem_name),
        ]
    );
    await markAdminClaimNotificationsRead(conn, claim.Claim_ID);
    return {
        response: {
            message: 'บันทึกการคืนสิ่งของเรียบร้อยแล้ว',
            Claim_status: 'คืนสิ่งของแล้ว',
            Lost_status: 'ได้รับสิ่งของคืนแล้ว',
            Found_status: 'คืนสิ่งของแล้ว',
        },
    };
}));

module.exports = router;