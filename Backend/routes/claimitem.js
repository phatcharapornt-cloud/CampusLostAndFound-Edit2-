const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { processMatchingByLostItem } = require('../service/matchingService');

// 1. API ผู้ใช้งานกด Request Claim (POST /api/claim/request)
router.post('/request', async (req, res) => {
    const { Match_ID, User_ID } = req.body;

    if (!Match_ID || !User_ID) {
        return res.status(400).json({
            success: false,
            message: 'กรุณาระบุ Match_ID และ User_ID'
        });
    }

    try {
        // ดึงข้อมูลการจับคู่และรายละเอียด LostItem
        const selectMatchQuery = `
            SELECT m.Match_ID, m.Lost_ID, m.Found_ID, m.Match_status, l.LostItem_name, l.Lost_description, n.Notice_at 
            FROM MatchItem m
            JOIN LostItem l ON m.Lost_ID = l.Lost_ID
            LEFT JOIN Notification n ON n.Match_ID = m.Match_ID AND n.User_ID IS NOT NULL   -- เวลาที่แจ้งผู้ใช้ (ไม่ใช่การแจ้งเตือนของ Admin)
            WHERE m.Match_ID = ?
        `;
        const [matches] = await db.query(selectMatchQuery, [Match_ID]);

        if (matches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบข้อมูลการจับคู่สิ่งของนี้'
            });
        }

        const matchData = matches[0];

        // ตรวจสอบว่าเกิน 24 ชม. หรือถูกปฏิเสธไปแล้วหรือไม่
        if (matchData.Notice_at) {
            const noticeTime = new Date(matchData.Notice_at).getTime();
            const currentTime = new Date().getTime();
            const diffInHours = (currentTime - noticeTime) / (1000 * 60 * 60);

            if (diffInHours >= 24 || matchData.Match_status === 'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน') {
                // 1. ปรับสถานะ Match เป็น 'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน'
                await db.query(
                    "UPDATE MatchItem SET Match_status = 'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน' WHERE Match_ID = ?",
                    [Match_ID]
                );

                // 2. ปรับสถานะสิ่งของที่หายกลับเป็น 'ไม่พบ'
                await db.query(
                    "UPDATE LostItem SET Lost_status = 'ไม่พบ' WHERE Lost_ID = ?",
                    [matchData.Lost_ID]
                );

                // 3. รันประมวลผลจับคู่ใหม่ทันที (จะไม่จับคู่กับ Found_ID เดิม)
                processMatchingByLostItem(matchData.Lost_ID);

                return res.status(400).json({
                    success: false,
                    message: 'รายการนี้หมดอายุเกิน 24 ชั่วโมงแล้ว ไม่สามารถส่งคำขอรับสิ่งของคืนได้ ระบบได้ทำการเริ่มค้นหาของให้อีกครั้งเรียบร้อยแล้ว'
                });
            }
        }

        // Claim_detail: ดึงข้อมูลรายละเอียดของสิ่งของที่หาย
        const claimDetail = `${matchData.LostItem_name} - ${matchData.Lost_description}`.substring(0, 200);

        // บันทึกข้อมูลลงตาราง Claim (Admin_ID = NULL, Status = 'รอการอนุมัติ', Claimcheck_at = NULL)
        const insertClaimQuery = `
            INSERT INTO Claim (Admin_ID, Claim_detail, Claim_status, Claim_date, Claimcheck_at, Match_ID, Lost_ID, Found_ID, User_ID)
            VALUES (NULL, ?, 'รอการอนุมัติ', CURDATE(), NULL, ?, ?, ?, ?)
        `;

        const [claimResult] = await db.query(insertClaimQuery, [
            claimDetail,
            Match_ID,
            matchData.Lost_ID,
            matchData.Found_ID,
            User_ID
        ]);

        const newClaimId = claimResult.insertId;

        // อัปเดต Claim_ID กลับไปยัง Notification
        await db.query(
            'UPDATE Notification SET Claim_ID = ? WHERE Match_ID = ? AND User_ID = ?',
            [newClaimId, Match_ID, User_ID]
        );

        // อัปเดตสถานะ Match เป็น "ผู้ใช้งานยืนยันการขอรับสิ่งของคืน"
        await db.query(
            "UPDATE MatchItem SET Match_status = 'ผู้ใช้งานยืนยันการขอรับสิ่งของคืน' WHERE Match_ID = ?",
            [Match_ID]
        );

        res.status(201).json({
            success: true,
            message: 'ส่งคำขอรับสิ่งของคืน (Request Claim) เรียบร้อยแล้ว',
            Claim_ID: newClaimId
        });

    } catch (error) {
        console.error('Error requesting claim:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการส่งคำขอรับสิ่งของคืน'
        });
    }
});

// 2. API ดึงรายการ Request Claim ที่รออนุมัติ ส่งไปให้ Admin (GET /api/claim/pending)
router.get('/pending', async (req, res) => {
    try {
        const selectPendingClaimsQuery = `
            SELECT 
                -- ข้อมูลการขอรับสิ่งของ
                c.Claim_ID,
                c.Claim_detail,
                c.Claim_status,
                c.Claim_date,
                c.Match_ID,
                c.Lost_ID,
                c.Found_ID,

                -- ข้อมูลผู้ใช้งาน
                u.User_ID,
                u.FName,
                u.LName,
                u.Student_ID,
                u.Email,

                -- ข้อมูลสิ่งของที่พบ
                f.FoundItem_name,
                f.Found_photo
            FROM Claim c
            LEFT JOIN User u ON c.User_ID = u.User_ID
            LEFT JOIN FoundItem f ON c.Found_ID = f.Found_ID
            WHERE c.Claim_status = 'รอการอนุมัติ'
            ORDER BY c.Claim_date DESC
        `;

        const [pendingClaims] = await db.query(selectPendingClaimsQuery);

        res.json({
            success: true,
            pendingClaims
        });
    } catch (error) {
        console.error('Error fetching pending claims:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงรายการคำขอรับสิ่งของคืน'
        });
    }
});

// 3. API Admin กดอนุมัติ Claim (PUT /api/claim/approve/:claimId)
router.put('/approve/:claimId', async (req, res) => {
    const { claimId } = req.params;
    const { Admin_ID } = req.body;

    if (!Admin_ID) {
        return res.status(400).json({
            success: false,
            message: 'กรุณาระบุ Admin_ID ผู้ดำเนินการ'
        });
    }

    try {
        const updateClaimQuery = `
            UPDATE Claim
            SET Claim_status = 'อนุมัติ', Admin_ID = ?, Claimcheck_at = NOW()
            WHERE Claim_ID = ? AND Claim_status = 'รอการอนุมัติ'
        `;

        const [result] = await db.query(updateClaimQuery, [Admin_ID, claimId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรายการคำขอ หรือรายการนี้ได้รับการดำเนินการไปแล้ว'
            });
        }

        res.json({
            success: true,
            message: 'อนุมัติคำขอรับสิ่งของคืนเรียบร้อยแล้ว'
        });
    } catch (error) {
        console.error('Error approving claim:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการอนุมัติคำขอ'
        });
    }
});

// 4. API Admin กดปฏิเสธ Claim (PUT /api/claim/reject/:claimId)
router.put('/reject/:claimId', async (req, res) => {
    const { claimId } = req.params;
    const { Admin_ID } = req.body;

    if (!Admin_ID) {
        return res.status(400).json({
            success: false,
            message: 'กรุณาระบุ Admin_ID ผู้ดำเนินการ'
        });
    }

    try {
        const updateClaimQuery = `
            UPDATE Claim
            SET Claim_status = 'ปฏิเสธ', Admin_ID = ?, Claimcheck_at = NOW()
            WHERE Claim_ID = ? AND Claim_status = 'รอการอนุมัติ'
        `;

        const [result] = await db.query(updateClaimQuery, [Admin_ID, claimId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรายการคำขอ หรือรายการนี้ได้รับการดำเนินการไปแล้ว'
            });
        }

        res.json({
            success: true,
            message: 'ปฏิเสธคำขอรับสิ่งของคืนเรียบร้อยแล้ว'
        });
    } catch (error) {
        console.error('Error rejecting claim:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการปฏิเสธคำขอ'
        });
    }
});

// 5. API Admin ยืนยันการคืนสิ่งของเรียบร้อย (PUT /api/claim/returned/:claimId)
router.put('/returned/:claimId', async (req, res) => {
    const { claimId } = req.params;
    const { Admin_ID } = req.body;

    if (!Admin_ID) {
        return res.status(400).json({
            success: false,
            message: 'กรุณาระบุ Admin_ID ผู้ดำเนินการ'
        });
    }

    const connection = await db.getConnection(); // ใช้ Transaction เพื่อเปลี่ยนสถานะตารางที่เกี่ยวข้องพร้อมกันอย่างปลอดภัย

    try {
        await connection.beginTransaction();

        // 1. ค้นหาข้อมูล Claim เพื่อเอา Lost_ID และ Found_ID
        const [claims] = await connection.query(
            'SELECT Lost_ID, Found_ID, Claim_status FROM Claim WHERE Claim_ID = ?',
            [claimId]
        );

        if (claims.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรายการคำขอนี้ในระบบ'
            });
        }

        const claim = claims[0];

        if (claim.Claim_status !== 'อนุมัติ') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'รายการนี้ยังไม่อยู่ในสถานะอนุมัติ ไม่สามารถเปลี่ยนเป็นคืนสิ่งของแล้วได้'
            });
        }

        // 2. อัปเดตตาราง Claim เป็น 'คืนสิ่งของแล้ว'
        await connection.query(
            'UPDATE Claim SET Claim_status = "คืนสิ่งของแล้ว", Admin_ID = ?, Claimcheck_at = NOW() WHERE Claim_ID = ?',
            [Admin_ID, claimId]
        );

        // 3. อัปเดต FoundItem เป็น 'คืนสิ่งของแล้ว' (เฉพาะรายการที่ผูกกับ Claim นี้)
        await connection.query(
            'UPDATE FoundItem SET Found_status = "คืนสิ่งของแล้ว" WHERE Found_ID = ?',
            [claim.Found_ID]
        );

        // 4. อัปเดต LostItem เป็น 'ได้รับสิ่งของคืนแล้ว' (เฉพาะรายการที่ผูกกับ Claim นี้)
        await connection.query(
            'UPDATE LostItem SET Lost_status = "ได้รับสิ่งของคืนแล้ว" WHERE Lost_ID = ?',
            [claim.Lost_ID]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'ยืนยันการคืนสิ่งของและปรับอัปเดตสถานะสิ่งของที่พบ/ที่หายเรียบร้อยแล้ว'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error confirming item return:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการบันทึกการคืนสิ่งของ'
        });
    } finally {
        connection.release();
    }
});

module.exports = router;