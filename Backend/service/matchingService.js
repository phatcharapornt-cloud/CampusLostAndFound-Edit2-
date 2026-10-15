const db = require('../config/db');

// ฟังก์ชันคำนวณความคล้ายของข้อความ (Keyword Overlap)
function calculateTextSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    if (words1.length === 0 || words2.length === 0) return 0;
    let matchCount = 0;
    words1.forEach(word => {
        if (words2.some(w => w.includes(word) || word.includes(w))) {
            matchCount++;
        }
    });

    return matchCount / Math.max(words1.length, words2.length);
}

// ฟังก์ชันตรวจสอบรายการ Match ที่ผู้ใช้งานไม่กดRequestClaim ภายใน 24 ชั่วโมง
async function checkAndProcessExpiredMatches() {
    try {
        // ค้นหารายการ Match ที่ส่งให้ User แล้วเกิน 24 ชั่วโมง (อ้างอิงเวลาจาก Notification)
        const expiredQuery = `
            SELECT m.Match_ID, m.Lost_ID, m.Found_ID
            FROM MatchItem m
            JOIN Notification n ON m.Match_ID = n.Match_ID
            WHERE m.Match_status = 'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน'
              AND TIMESTAMPDIFF(HOUR, n.Notice_at, NOW()) >= 24
        `;
        const [expiredMatches] = await db.query(expiredQuery);

        for (const match of expiredMatches) {
            // 1. อัปเดตสถานะ Matchเป็น 'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน'
            await db.query(
                "UPDATE MatchItem SET Match_status = 'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน' WHERE Match_ID = ?",
                [match.Match_ID]
            );

            // 2. อัปเดตสถานะของหายกลับเป็น 'ไม่พบ'
            await db.query(
                "UPDATE LostItem SET Lost_status = 'ไม่พบ' WHERE Lost_ID = ?",
                [match.Lost_ID]
            );

            console.log(`[Auto Expire] Match_ID ${match.Match_ID} หมดอายุเกิน 24 ชม. -> รีเซ็ต Lost_ID ${match.Lost_ID} เป็น 'ไม่พบ'`);

            // 3. เริ่มประมวลผลจับคู่ใหม่ทันที (จะไม่จับคู่กับ Found_ID เดิมเพราะยังมี record ใน MatchItem)
            await processMatchingByLostItem(match.Lost_ID);
        }
    } catch (error) {
        console.error('Error in checkAndProcessExpiredMatches:', error);
    }
}


// 1. ประมวลผลการจับคู่ เมื่อผู้ใช้งานทำการแจ้งสิ่งของที่หาย
async function processMatchingByLostItem(lostId) {
    try {
        const [lostItems] = await db.query("SELECT * FROM LostItem WHERE Lost_ID = ? AND Lost_status = 'ไม่พบ'", [lostId]);
        if (lostItems.length === 0) return;
        const lost = lostItems[0];

        const [foundItems] = await db.query("SELECT * FROM FoundItem WHERE Found_status = 'อนุมัติแล้ว'");

        for (const found of foundItems) {

            // 1. คำนวณคะแนนหมวดหมู่ (น้ำหนัก 30%): ถ้า Category_ID ตรงกันได้ 30 คะแนน ถ้าไม่ตรงได้ 0
            let categoryScore = (lost.Category_ID === found.Category_ID) ? 30 : 0;

            // 2. คำนวณคะแนนสถานที่ (น้ำหนัก 25%): ถ้า Location_ID ตรงกันได้ 25 คะแนน ถ้าไม่ตรงได้ 0
            let locationScore = (lost.Location_ID === found.Location_ID) ? 25 : 0;

            // 3. คำนวณคะแนนชื่อสิ่งของ (น้ำหนัก 30%):
            // หาอัตราส่วนความคล้ายของข้อความ (ค่าระหว่าง 0.0 - 1.0) แล้วแปลงเป็นคะแนนเต็ม 30
            let nameSim = calculateTextSimilarity(lost.LostItem_name, found.FoundItem_name);
            let nameScore = nameSim * 30;

            // 4. คำนวณคะแนนรายละเอียดสิ่งของ (น้ำหนัก 15%): 
            // หาอัตราส่วนความคล้ายของคำอธิบาย (ค่าระหว่าง 0.0 - 1.0) แล้วแปลงเป็นคะแนนเต็ม 15
            let descSim = calculateTextSimilarity(lost.Lost_description, found.Found_description);
            let descScore = descSim * 15;

            // รวมคะแนนทั้ง 4 ปัจจัยเข้าด้วยกัน (คะแนนรวมเต็ม 100 คะแนน)
            let totalScore = categoryScore + locationScore + nameScore + descScore;

            if (totalScore >= 80) {

                // ตรวจสอบในตาราง MatchItem ว่าเคยมีการบันทึกคู่นี้ไปแล้วหรือยัง
                const [existingMatch] = await db.query(
                    "SELECT * FROM MatchItem WHERE Lost_ID = ? AND Found_ID = ?",
                    [lost.Lost_ID, found.Found_ID]
                );

                // หากยังไม่เคยจับคู่กันมาก่อน ให้ทำการบันทึกข้อมูลใหม่ลงฐานข้อมูล
                if (existingMatch.length === 0) {
                    await db.query(
                        `INSERT INTO MatchItem (Lost_ID, Found_ID, Match_score, Match_date, Match_time) 
                         VALUES (?, ?, ?, CURRENT_DATE, CURRENT_TIME)`,
                        [lost.Lost_ID, found.Found_ID, totalScore.toFixed(2)]
                    );
                    console.log(`[Auto Match] Inserted MatchItem: Lost_ID ${lost.Lost_ID} <-> Found_ID ${found.Found_ID} (Score: ${totalScore.toFixed(2)}%)`);
                }
            }
        }
    } catch (error) {
        console.error('Error in processMatchingByLostItem:', error);
    }
}

// 2. ประมวลผลการจับคู่เมื่อมีสิ่งของที่พบได้รับการอนุมัติ
async function processMatchingByFoundItem(foundId) {
    try {

        // 1. ดึงข้อมูลของที่พบจาก Found_ID โดยต้องมีสถานะเป็น 'อนุมัติแล้ว' เท่านั้น
        const [foundItems] = await db.query(
            "SELECT * FROM FoundItem WHERE Found_ID = ? AND Found_status = 'อนุมัติแล้ว'",
            [foundId]
        );

        // ถ้าไม่พบข้อมูล หรือสิ่งของยังไม่อนุมัติ ให้ยุติการทำงานทันที
        if (foundItems.length === 0) return;
        const found = foundItems[0];

       // 2. ดึงรายการของหายทั้งหมดในระบบที่ยังมีสถานะเป็น 'ไม่พบ' (เพื่อนำมาเปรียบเทียบจับคู่) 
        const [lostItems] = await db.query("SELECT * FROM LostItem WHERE Lost_status = 'ไม่พบ'");

        for (const lost of lostItems) {

            // คำนวณคะแนนหมวดหมู่ (น้ำหนัก 30%): ถ้า Category_ID ตรงกันได้ 30 คะแนน ถ้าไม่ตรงได้ 0
            let categoryScore = (lost.Category_ID === found.Category_ID) ? 30 : 0;

            //คำนวณคะแนนสถานที่ (น้ำหนัก 25%): ถ้า Location_ID ตรงกันได้ 25 คะแนน ถ้าไม่ตรงได้ 0
            let locationScore = (lost.Location_ID === found.Location_ID) ? 25 : 0;

            // คำนวณคะแนนชื่อสิ่งของ (น้ำหนัก 30%):
            // หาอัตราส่วนความคล้ายของข้อความ (ค่าระหว่าง 0.0 - 1.0) แล้วแปลงเป็นคะแนนเต็ม 30
            let nameSim = calculateTextSimilarity(lost.LostItem_name, found.FoundItem_name);
            let nameScore = nameSim * 30;

            // คำนวณคะแนนรายละเอียดสิ่งของ (น้ำหนัก 15%): 
            // หาอัตราส่วนความคล้ายของคำอธิบาย (ค่าระหว่าง 0.0 - 1.0) แล้วแปลงเป็นคะแนนเต็ม 15
            let descSim = calculateTextSimilarity(lost.Lost_description, found.Found_description);
            let descScore = descSim * 15;

            // รวมคะแนนทั้ง 4 ปัจจัยเข้าด้วยกัน (คะแนนรวมเต็ม 100 คะแนน)
            let totalScore = categoryScore + locationScore + nameScore + descScore;

            if (totalScore >= 80) {

                // ตรวจสอบในตาราง MatchItem ว่าเคยมีการบันทึกคู่นี้ไปแล้วหรือยัง
                const [existingMatch] = await db.query(
                    "SELECT * FROM MatchItem WHERE Lost_ID = ? AND Found_ID = ?",
                    [lost.Lost_ID, found.Found_ID]
                );

                // หากยังไม่เคยจับคู่กันมาก่อน ให้ทำการบันทึกข้อมูลใหม่ลงฐานข้อมูล
                if (existingMatch.length === 0) {
                    await db.query(
                        `INSERT INTO MatchItem (Lost_ID, Found_ID, Match_score, Match_date, Match_time) 
                         VALUES (?, ?, ?, CURRENT_DATE, CURRENT_TIME)`,
                        [lost.Lost_ID, found.Found_ID, totalScore.toFixed(2)]
                    );
                    console.log(`[Auto Match] Inserted MatchItem: Lost_ID ${lost.Lost_ID} <-> Found_ID ${found.Found_ID} (Score: ${totalScore.toFixed(2)}%)`);
                }
            }
        }
    } catch (error) {
        console.error('Error in processMatchingByFoundItem:', error);
    }
}

module.exports = {
    calculateTextSimilarity,
    checkAndProcessExpiredMatches,
    processMatchingByLostItem,
    processMatchingByFoundItem
};