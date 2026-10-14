const express = require('express');
const router = express.Router();
const db = require('../config/db');
const {processMatchingByLostItem} = require('../service/matchingService');

// 1. API การประมวลผลจับคู่สิ่งของที่หาย (POST /api/match/run/:lostId)
router.post('/run/:lostId', async (req, res) => {
    try {
        const { lostId } = req.params;
        await processMatchingByLostItem(lostId);
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
                m.Match_time,
                
                -- ข้อมูลของหาย
                l.Lost_ID,
                l.LostItem_name,
                l.Lost_date,
                l.Lost_time,
                l.Lost_description,
                l.Lost_photo,
                l.Lost_status,

                -- ข้อมูลเจ้าของของสิ่งของที่หาย
                u_lost.User_ID AS Lost_User_ID,
                u_lost.FName AS Lost_User_FName,
                u_lost.LName AS Lost_User_LName,
                u_lost.Email AS Lost_User_Email,

                -- ข้อมูลของที่พบ
                f.Found_ID,
                f.FoundItem_name,
                f.Found_date,
                f.Found_time,
                f.Found_description,
                f.Found_photo,
                f.Found_status,

                -- ข้อมูลหมวดหมู่และสถานที่
                c.Category_name,
                loc.Location_name

            FROM MatchItem m
            JOIN LostItem l ON m.Lost_ID = l.Lost_ID
            JOIN FoundItem f ON m.Found_ID = f.Found_ID
            LEFT JOIN Category c ON l.Category_ID = c.Category_ID
            LEFT JOIN Location loc ON l.Location_ID = loc.Location_ID
            LEFT JOIN User u_lost ON l.User_ID = u_lost.User_ID

            -- กรองรายการที่ Admin เคยกดอนุมัติ (ส่ง Notification ให้ User) ออกไป
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

    try {
        const { matchId } = req.params;
        // ดึงข้อมูลการจับคู่
        const [matches] = await db.query('SELECT * FROM MatchItem WHERE Match_ID = ?', [matchId]);

        if (matches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบข้อมูลการจับคู่'
            });
        }

        const match = matches[0];

        const [lostItems] = await db.query('SELECT * FROM LostItem WHERE Lost_ID = ?', [match.Lost_ID]);
        if (lostItems.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบข้อมูลสิ่งของที่หาย'
            });
        }
        const lost = lostItems[0];

        const [foundItems] = await db.query('SELECT * FROM FoundItem WHERE Found_ID = ?', [match.Found_ID]);
        const foundName = foundItems.length > 0 ? foundItems[0].FoundItem_name : 'สิ่งของ';

        const notiMessage = `ระบบพบรายการสิ่งของที่คาดว่าเป็นของคุณ: "${foundName}" (คะแนนความตรงกัน ${match.Match_score}%)`;


        // สร้าง Notification แจ้งไปยังผู้ใช้งานที่แจ้งของหาย
        await db.query(
            `INSERT INTO Notification (User_ID, Lost_ID, Found_ID, Match_ID, Message) 
             VALUES (?, ?, ?, ?, ?)`,
            [lost.User_ID, match.Lost_ID, match.Found_ID, matchId, notiMessage]
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

// ส่งออก router ออกไปใช้งานโดยตรง
module.exports = router;