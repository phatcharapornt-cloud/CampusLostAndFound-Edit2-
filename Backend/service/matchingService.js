// ระบบจับคู่สิ่งของที่หาย (LostItem) กับสิ่งของที่พบ (FoundItem)
//
// จับคู่เฉพาะ: สิ่งของที่พบ 'อนุมัติแล้ว' กับ สิ่งของที่หาย 'ไม่พบ'
//   และต้องเป็นคนละคนกัน (รหัสนักศึกษาของผู้แจ้งหายกับผู้แจ้งพบห้ามตรงกัน = User_ID ต่างกัน)
//   - Admin อนุมัติสิ่งของที่พบ / บันทึกสิ่งของที่พบเอง → processMatchingByFoundItem(Found_ID)
//   - ผู้ใช้แจ้งสิ่งของที่หาย                           → processMatchingByLostItem(Lost_ID)
// คำนวณ Match Score ใหม่ทุกครั้ง (เต็ม 100): หมวดหมู่ 30 + สถานที่ 25 + ชื่อสิ่งของ 30 + รายละเอียด 15
// ถ้า Match Score มากกว่า 70 และคู่นี้ยังไม่เคยถูกจับคู่ → บันทึกลง MatchItem (Match_status = NULL = รอ Admin ตรวจสอบ)
// และแจ้งเตือน Admin ทุกคนว่า "พบรายการจับคู่สิ่งของรายการใหม่" (Admin ดูได้ที่หน้า "รายการจับคู่สิ่งของ")
const db = require('../config/db');

const MATCH_THRESHOLD = 70;             // จับคู่เมื่อ Match Score "มากกว่า" ค่านี้ (70 พอดีไม่นับ)
const WEIGHTS = { category: 30, location: 25, name: 30, description: 15 };
const CLAIM_WINDOW_HOURS = 24;          // ผู้ใช้ต้องส่งคำขอรับคืนภายในกี่ชั่วโมงหลังได้รับการแจ้งเตือน
const EXPIRY_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// คะแนนผ่านเกณฑ์จับคู่หรือไม่
function passesThreshold(total) {
    return total > MATCH_THRESHOLD;
}

// ตัดคำ (รองรับภาษาไทยที่เขียนติดกัน เช่น "กระเป๋าสตางค์สีดำ" → กระเป๋า / สตางค์ / สี / ดำ)
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
function tokenize(text) {
    const lower = String(text || '').toLowerCase();
    const words = segmenter
        ? [...segmenter.segment(lower)].filter((part) => part.isWordLike).map((part) => part.segment)
        : lower.split(/\s+/);
    return [...new Set(words.map((word) => word.trim()).filter((word) => word.length > 1))];
}

// ฟังก์ชันคำนวณความคล้ายของข้อความ (Keyword Overlap) ได้ค่า 0.0 - 1.0
function calculateTextSimilarity(str1, str2) {
    const words1 = tokenize(str1);
    const words2 = tokenize(str2);
    if (words1.length === 0 || words2.length === 0) return 0;

    let matchCount = 0;
    words1.forEach((word) => {
        if (words2.some((w) => w.includes(word) || word.includes(w))) matchCount++;
    });
    return matchCount / Math.max(words1.length, words2.length);
}

// คำนวณ Match Score ของคู่หนึ่ง พร้อมคะแนนแยกแต่ละส่วน (ใช้แสดงในหน้า Admin ด้วย)
function computeMatchScore(lost, found) {
    const parts = {
        category: lost.Category_ID === found.Category_ID ? WEIGHTS.category : 0,
        location: lost.Location_ID === found.Location_ID ? WEIGHTS.location : 0,
        name: calculateTextSimilarity(lost.LostItem_name, found.FoundItem_name) * WEIGHTS.name,
        description: calculateTextSimilarity(lost.Lost_description, found.Found_description) * WEIGHTS.description,
    };
    for (const key of Object.keys(parts)) parts[key] = Math.round(parts[key] * 100) / 100;
    const total = Math.round((parts.category + parts.location + parts.name + parts.description) * 100) / 100;
    return { total, parts, max: WEIGHTS };
}

// แสดงคะแนนแบบไม่มีทศนิยมที่ไม่จำเป็น: 88.00 → "88", 92.50 → "92.5"
function formatScore(score) {
    return String(Number(Number(score).toFixed(2)));
}

// บันทึกคู่ใหม่ (ถ้าคู่นี้ยังไม่เคยถูกจับคู่ในสถานะใดก็ตาม) + แจ้งเตือน Admin ทุกคน คืนค่า Match_ID หรือ null
async function saveMatchIfNew(lost, found, score) {
    if (lost.User_ID === found.User_ID) return null;   // ผู้ใช้คนเดียวกัน ห้ามจับคู่
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [result] = await conn.query(
            `INSERT INTO MatchItem (Lost_ID, Found_ID, Match_score, Match_date, Match_time)
             SELECT ?, ?, ?, CURRENT_DATE, CURRENT_TIME FROM DUAL
             WHERE NOT EXISTS (SELECT 1 FROM MatchItem WHERE Lost_ID = ? AND Found_ID = ?)`,
            [lost.Lost_ID, found.Found_ID, score.toFixed(2), lost.Lost_ID, found.Found_ID]
        );
        if (result.affectedRows === 0) {
            await conn.rollback();
            return null;
        }
        const matchId = result.insertId;
        await conn.query(
            'INSERT INTO Notification (Admin_ID, Lost_ID, Found_ID, Match_ID, Message) SELECT Admin_ID, ?, ?, ?, ? FROM Admin',
            [
                lost.Lost_ID,
                found.Found_ID,
                matchId,
                `พบรายการจับคู่สิ่งของรายการใหม่ (Match Score ${formatScore(score)}%) สิ่งของที่หาย #${lost.Lost_ID} กับสิ่งของที่พบ #${found.Found_ID}`
            ]
        );
        await conn.commit();
        console.log(`[Auto Match] Inserted MatchItem #${matchId}: Lost_ID ${lost.Lost_ID} <-> Found_ID ${found.Found_ID} (Score: ${score.toFixed(2)}%)`);
        return matchId;
    } catch (error) {
        await conn.rollback().catch(() => {});
        throw error;
    } finally {
        conn.release();
    }
}

// 1. ประมวลผลการจับคู่ เมื่อผู้ใช้งานทำการแจ้งสิ่งของที่หาย (หรือสิ่งของที่หายกลับมาเป็น 'ไม่พบ')
async function processMatchingByLostItem(lostId) {
    try {
        const [lostItems] = await db.query("SELECT * FROM LostItem WHERE Lost_ID = ? AND Lost_status = 'ไม่พบ'", [lostId]);
        if (lostItems.length === 0) return [];
        const lost = lostItems[0];

        // ไม่จับคู่กับสิ่งของที่ผู้ใช้คนเดียวกันเป็นผู้แจ้งพบ (รหัสนักศึกษาตรงกัน)
        const [foundItems] = await db.query(
            "SELECT * FROM FoundItem WHERE Found_status = 'อนุมัติแล้ว' AND User_ID <> ?",
            [lost.User_ID]
        );
        const created = [];
        for (const found of foundItems) {
            const { total } = computeMatchScore(lost, found);
            if (passesThreshold(total)) {
                const matchId = await saveMatchIfNew(lost, found, total);
                if (matchId) created.push(matchId);
            }
        }
        return created;
    } catch (error) {
        console.error('Error in processMatchingByLostItem:', error);
        return [];
    }
}

// 2. ประมวลผลการจับคู่ เมื่อมีสิ่งของที่พบได้รับการอนุมัติ
async function processMatchingByFoundItem(foundId) {
    try {
        const [foundItems] = await db.query(
            "SELECT * FROM FoundItem WHERE Found_ID = ? AND Found_status = 'อนุมัติแล้ว'",
            [foundId]
        );
        if (foundItems.length === 0) return [];
        const found = foundItems[0];

        // ไม่จับคู่กับสิ่งของที่หายของผู้ใช้คนเดียวกับผู้แจ้งพบ (รหัสนักศึกษาตรงกัน)
        const [lostItems] = await db.query(
            "SELECT * FROM LostItem WHERE Lost_status = 'ไม่พบ' AND User_ID <> ?",
            [found.User_ID]
        );
        const created = [];
        for (const lost of lostItems) {
            const { total } = computeMatchScore(lost, found);
            if (passesThreshold(total)) {
                const matchId = await saveMatchIfNew(lost, found, total);
                if (matchId) created.push(matchId);
            }
        }
        return created;
    } catch (error) {
        console.error('Error in processMatchingByFoundItem:', error);
        return [];
    }
}

// ตรวจรายการจับคู่ที่ส่งให้ผู้ใช้งานแล้ว แต่ผู้ใช้ไม่ส่งคำขอรับคืนภายใน 24 ชั่วโมง
// → Match_status 'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน', สิ่งของที่หายกลับเป็น 'ไม่พบ' แล้วเริ่มจับคู่ใหม่ (ไม่จับกับคู่เดิมอีก)
// นับเวลาจากการแจ้งเตือนที่ส่งถึงเจ้าของสิ่งของที่หาย (ไม่นับการแจ้งเตือนของ Admin)
async function checkAndProcessExpiredMatches() {
    try {
        const [expiredMatches] = await db.query(
            `SELECT m.Match_ID, m.Lost_ID, m.Found_ID
             FROM MatchItem m
             JOIN LostItem l ON m.Lost_ID = l.Lost_ID
             WHERE m.Match_status = 'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน'
               AND (SELECT MIN(n.Notice_at) FROM Notification n
                     WHERE n.Match_ID = m.Match_ID AND n.User_ID = l.User_ID) <= NOW() - INTERVAL ? HOUR`,
            [CLAIM_WINDOW_HOURS]
        );

        for (const match of expiredMatches) {
            await db.query(
                "UPDATE MatchItem SET Match_status = 'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน' WHERE Match_ID = ? AND Match_status = 'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน'",
                [match.Match_ID]
            );
            // ปรับเฉพาะของที่ยังเป็น 'พบ' (ถ้าผู้ใช้ยกเลิกรายการไปแล้ว จะไม่เปลี่ยนกลับ)
            await db.query("UPDATE LostItem SET Lost_status = 'ไม่พบ' WHERE Lost_ID = ? AND Lost_status = 'พบ'", [match.Lost_ID]);
            console.log(`[Auto Expire] Match_ID ${match.Match_ID} เกิน ${CLAIM_WINDOW_HOURS} ชม. -> รีเซ็ต Lost_ID ${match.Lost_ID} เป็น 'ไม่พบ'`);
            await processMatchingByLostItem(match.Lost_ID);
        }
        return expiredMatches.map((m) => m.Match_ID);
    } catch (error) {
        console.error('Error in checkAndProcessExpiredMatches:', error);
        return [];
    }
}

// 3. จับคู่สิ่งของที่หาย 'ไม่พบ' ทุกรายการใหม่อีกครั้ง (เรียกตอนเปิดเซิร์ฟเวอร์)
// ใช้เมื่อเปลี่ยนเกณฑ์/สูตรคะแนน: คู่เดิมที่เคยได้คะแนนไม่ถึงเกณฑ์จะถูกจับคู่ทันที
// คู่ที่เคยบันทึกแล้ว (รวมคู่ที่ Admin ปฏิเสธ) จะไม่ถูกสร้างซ้ำ
async function rematchAllLostItems() {
    try {
        const [lostItems] = await db.query("SELECT Lost_ID FROM LostItem WHERE Lost_status = 'ไม่พบ' ORDER BY Lost_ID");
        const created = [];
        for (const { Lost_ID } of lostItems) created.push(...await processMatchingByLostItem(Lost_ID));
        if (created.length > 0) console.log(`[Match] จับคู่ใหม่ตอนเปิดเซิร์ฟเวอร์ ${created.length} รายการ (Match_ID ${created.join(', ')})`);
        return created;
    } catch (error) {
        console.error('Error in rematchAllLostItems:', error);
        return [];
    }
}

// 4. ลบรายการจับคู่ที่ยังรอ Admin ตรวจสอบ ซึ่งผู้แจ้งหายกับผู้แจ้งพบเป็นคนเดียวกัน (เกิดก่อนมีเงื่อนไขนี้)
// ยังไม่เคยแจ้งผู้ใช้ จึงลบได้เลย (การแจ้งเตือน Admin ของคู่นั้นถูกลบตามด้วย ON DELETE CASCADE)
async function removeSameUserPendingMatches() {
    try {
        const [result] = await db.query(
            `DELETE m FROM MatchItem m
             JOIN LostItem l  ON m.Lost_ID = l.Lost_ID
             JOIN FoundItem f ON m.Found_ID = f.Found_ID
             WHERE m.Match_status IS NULL AND l.User_ID = f.User_ID`
        );
        if (result.affectedRows > 0) console.log(`[Match] ลบรายการจับคู่ที่ผู้แจ้งหายกับผู้แจ้งพบเป็นคนเดียวกัน ${result.affectedRows} รายการ`);
        return result.affectedRows;
    } catch (error) {
        console.error('Error in removeSameUserPendingMatches:', error);
        return 0;
    }
}

// เปิดเซิร์ฟเวอร์: ลบคู่ที่ผิดเงื่อนไข + ตรวจรายการที่หมดเวลา 24 ชม. + จับคู่ใหม่ทั้งหมด 1 ครั้ง แล้วตรวจการหมดเวลาทุก 5 นาที
function startMatchExpiryJob() {
    removeSameUserPendingMatches().then(checkAndProcessExpiredMatches).then(rematchAllLostItems);
    return setInterval(checkAndProcessExpiredMatches, EXPIRY_CHECK_INTERVAL_MS);
}

module.exports = {
    MATCH_THRESHOLD,
    passesThreshold,
    WEIGHTS,
    CLAIM_WINDOW_HOURS,
    tokenize,
    calculateTextSimilarity,
    computeMatchScore,
    formatScore,
    checkAndProcessExpiredMatches,
    startMatchExpiryJob,
    processMatchingByLostItem,
    processMatchingByFoundItem,
    rematchAllLostItems,
    removeSameUserPendingMatches
};