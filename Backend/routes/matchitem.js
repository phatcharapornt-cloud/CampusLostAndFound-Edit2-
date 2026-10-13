const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ฟังก์ชันต์คำนวนความคล้ายของข้อความแบบเปรียบเทียบคำ (Keyword Overlap)
function calculateTextSimilarity(str1, str2){
    if (!str1 || !str2) return 0;
    const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    if (words1.length === 0 || words2.length === 0) return 0;
    let matchCount=0;
    words1.forEach(word =>{
        if (words2.some(w => w.includes(word) || word.includes(w))) {
            matchCount++;
        }
    });

    return (matchCount / Math.max(words1.length, words2.length));
}

// ฟังก์ชันประมวลผลการจับคู่สิ่งของที่หายและสิ่งของที่พบทั้งหมดในระบบ
async function processMatching(lostId){
    try {
        // 1. ดึงข้อมูลสิ่งของที่หาย
        const [lostItems] = await db.query(
            'SELECT * FROM LostItem WHERE Lost_ID = ?', 
            [lostId]
        );
        if (lostItems.length === 0) return;
        const lost = lostItems[0];

        // 2. ดึงรายการสิ่งของที่พบทั้งหมดที่ได้รับการอนุมัติแล้ว
        const [foundItems] = await db.query(
            "SELECT * FROM FoundItem WHERE Found_status = 'อนุมัติแล้ว'"
        );

        for (const found of foundItems) {
            let score = 0;

            // เกณฑ์ที่ 1: หมวดหมู่ตรงกัน (30 คะแนน)
            if (lost.Category_ID === found.Category_ID) {
                score += 30;
            }

            // เกณฑ์ที่ 2: สถานที่ตรงกัน (25 คะแนน)
            if (lost.Location_ID === found.Location_ID) {
                score += 25;
            }

            // เกณฑ์ที่ 3: ชื่อและรายละเอียดสินค้าคล้ายกัน (สูงสุด 30 คะแนน)
            const text1 = `${lost.LostItem_name} ${lost.Lost_description}`;
            const text2 = `${found.FoundItem_name} ${found.Found_description}`;
            const textSimilar = calculateTextSimilarity(text1, text2);
            score += (textSimilar * 30);

            // เกณฑ์ที่ 4: ความใกล้เคียงของวันที่ (สูงสุด 15 คะแนน)
            if (lost.Lost_date && found.Found_date) {
                const diffTime = Math.abs(new Date(lost.Lost_date) - new Date(found.Found_date));
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays === 0) score += 15;
                else if (diffDays <= 1) score += 10;
                else if (diffDays <= 3) score += 5;
            }

            const matchScore = parseFloat(score.toFixed(2));

            // หาก MatchScore มากกว่าหรือเท่ากับ 80% ให้บันทึกลงตาราง MatchItem
            if (matchScore >= 80.00) {
                // ตรวจสอบก่อนว่าเคยจับคู่คู่นี้ไปหรือยัง
                const [existingMatch] = await db.query(
                    'SELECT Match_ID FROM MatchItem WHERE Lost_ID = ? AND Found_ID = ?',
                    [lost.Lost_ID, found.Found_ID]
                );

                if (existingMatch.length === 0) {
                    // บันทึกลงตาราง MatchItem
                    const [matchResult] = await db.query(
                        'INSERT INTO MatchItem (Lost_ID, Found_ID, Match_score) VALUES (?, ?, ?)',
                        [lost.Lost_ID, found.Found_ID, matchScore]
                    );

                    const newMatchId = matchResult.insertId;

                    // บันทึกการแจ้งเตือนไปยัง Admin ให้มาตรวจสอบอนุมัติ
                    await db.query(
                        `INSERT INTO Notification (User_ID, Lost_ID, Found_ID, Match_ID, Message, Admin_isread) 
                         VALUES (?, ?, ?, ?, ?, FALSE)`,
                        [
                            lost.User_ID, 
                            lost.Lost_ID, 
                            found.Found_ID, 
                            newMatchId, 
                            `พบสิ่งของที่อาจตรงกับรายการของหาย (Match Score: ${matchScore}%) รอการอนุมัติจากแอดมิน`
                        ]
                    );
                }
            }
        }
    } catch (error) {
        console.error('Error during processMatching:', error);
    }
}

// 1. API การประมวลผลจับคู่สิ่งของที่หาย (POST /api/match/run/:lostId)
router.post('/run/:lostId', async (req, res) => {
    const { lostId } = req.params;
    try {
        await processMatching(lostId);
        res.status(200).json({
            success: true,
            message: 'ประมวลผลการจับคู่สิ่งของเรียบร้อยแล้ว'
        });
    } catch (error) {
        console.error('Error running match:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการประมวลผลจับคู่'
        });
    }
});

// 2. API ดึงรายการจับคู่สิ่งของที่มากกว่า 80% เพื่อรอการอนุมัติ (GET /api/match/pending)
router.get('/pending', async (req, res) => {
    try {
        const query = `
            SELECT 
                m.Match_ID,
                m.Match_score,
                m.Match_date,
                m.Mathch_time,
                
                // ข้อมูลของหาย
                l.Lost_ID,
                l.LostItem_name,
                l.Lost_date,
                l.Lost_description,
                l.Lost_photo,
                u_lost.User_ID AS Lost_User_ID,
                u_lost.FName AS Lost_User_FName,
                u_lost.LName AS Lost_User_LName,
                u_lost.Email AS Lost_User_Email,

                // ข้อมูลของที่พบ
                f.Found_ID,
                f.FoundItem_name,
                f.Found_date,
                f.Found_description,
                f.Found_photo,
                c.Category_name,
                loc.Location_name

            FROM MatchItem m
            JOIN LostItem l ON m.Lost_ID = l.Lost_ID
            JOIN FoundItem f ON m.Found_ID = f.Found_ID
            LEFT JOIN Category c ON l.Category_ID = c.Category_ID
            LEFT JOIN Location loc ON l.Location_ID = loc.Location_ID
            LEFT JOIN User u_lost ON l.User_ID = u_lost.User_ID

            WHERE NOT EXISTS ( 
                SELECT 1 FROM Notification n 
                WHERE n.Match_ID = m.Match_ID AND n.User_ID = l.User_ID
            )

            ORDER BY m.Match_score DESC, m.Match_ID DESC
        `;

        const [pendingMatches] = await db.query(query);

        res.status(200).json({
            success: true,
            pendingMatches: pendingMatches
        });
    } catch (error) {
        console.error('Error fetching pending matches:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงรายการจับคู่'
        });
    }
});

// 3. API Admin ทำการอนุมัติการจับคู่ เพื่อส่งการแจ้งเตือนไปยังผู้ใช้งาน (PUT /api/match/approve/:matchId)
router.put('/approve/:matchId', async (req, res) => {
    const { matchId } = req.params;

    try {
        // ดึงข้อมูลการจับคู่
        const [matchRows] = await db.query(
            `SELECT m.*, l.User_ID AS LostUser_ID, f.FoundItem_name 
             FROM MatchItem m 
             JOIN LostItem l ON m.Lost_ID = l.Lost_ID
             JOIN FoundItem f ON m.Found_ID = f.Found_ID
             WHERE m.Match_ID = ?`,
            [matchId]
        );

        if (matchRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรายการจับคู่นี้'
            });
        }

        const match = matchRows[0];

        // สร้าง Notification แจ้งไปยังผู้ใช้งานที่แจ้งของหาย
        await db.query(
            `INSERT INTO Notification (User_ID, Lost_ID, Found_ID, Match_ID, Message, User_isread)
             VALUES (?, ?, ?, ?, ?, FALSE)`,
            [
                match.LostUser_ID,
                match.Lost_ID,
                match.Found_ID,
                match.Match_ID,
                `แอดมินอนุมัติการจับคู่แล้ว! พบสิ่งของ "${match.FoundItem_name}" ที่ตรงกับของหายของคุณ (ความคล้าย ${match.Match_score}%)`
            ]
        );

        res.status(200).json({
            success: true,
            message: 'อนุมัติการจับคู่และส่งการแจ้งเตือนไปยังผู้ใช้งานเรียบร้อยแล้ว'
        });
    } catch (error) {
        console.error('Error approving match:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการอนุมัติการจับคู่'
        });
    }
});

// 4. API Admin กดปฏิเสธ/ลบรายการจับคู่ที่ไม่ถูกต้อง (DELETE /api/match/reject/:matchId)
router.delete('/reject/:matchId', async (req, res) => {
    const { matchId } = req.params;

    try {
        const [result] = await db.query('DELETE FROM MatchItem WHERE Match_ID = ?', [matchId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรายการจับคู่ที่ต้องการลบ'
            });
        }

        res.status(200).json({
            success: true,
            message: 'ปฏิเสธและลบรายการจับคู่เรียบร้อยแล้ว'
        });
    } catch (error) {
        console.error('Error rejecting match:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการลบรายการจับคู่'
        });
    }
});

module.exports = {
    router,
    processMatching
};
