const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 1. ดึงรายการสิ่งของที่พบทั้งหมดที่สถานะเป็น 'รอการอนุมัติ' (GET /api/admin/pendingfound)
router.get('/pendingfound', async (req, res) => {
    try {
        const selectQuery = `
            SELECT  f.Found_ID, 
                    f.FoundItem_name, 
                    f.Found_date, 
                    f.Found_time, 
                    f.Found_description, 
                    f.Found_photo, 
                    c.Category_name, 
                    l.Location_name, 
                    u.FName,
                    u.LName,
                    u.Email
            FROM FoundItem f
            LEFT JOIN Category c ON f.Category_ID = c.Category_ID
            LEFT JOIN Location l ON f.Location_ID = l.Location_ID
            LEFT JOIN User u ON f.User_ID = u.User_ID
            WHERE f.Found_status = 'รอการอนุมัติ'
            ORDER BY f.Foundcheck_at DESC   
        `;
        
        const [pendingFoundItems] = await db.query(selectQuery);

        res.status(200).json({
            success: true,
            pendingFoundItems: pendingFoundItems
        });

    } catch (error) {
        console.error('Error fetching pending found items:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงรายการสิ่งของที่พบสถานะรอการอนุมัติ'
        });
    }
});

// 2. Admin กดอนุมัติสิ่งของที่พบ (PUT /api/admin/approvefound/:id)
router.put('/approvefound/:id', async (req, res) => {
    const {id} = req.params; // FoundItem_ID ที่ส่งมาจาก URL
    const {Admin_ID} = req.body; // รับ Admin_ID จาก body ของ request

    if (!Admin_ID) {
        return res.status(400).json({
            success: false,
            message: 'กรุณาระบุ Admin_ID ของผู้ดำเนินการ'
        });
    }

    try {
        const updateQuery = `
            UPDATE FoundItem
            SET Found_status = 'อนุมัติแล้ว', Admin_ID = ?
            WHERE Found_ID = ? AND Found_status = 'รอการอนุมัติ'
        `;

        const [result] = await db.query(updateQuery, [Admin_ID,id]);

        if (result.affectedRows === 0){
            return res.status(404).json ({
                success: false,
                message: 'ไม่พบรายการที่รออนุมัติ หรือรายการนี้ถูกอนุมัติไปแล้ว'
            });
        }

        res.status(200).json({
            success: true,
            message: 'อนุมัติสิ่งของที่พบเรียบร้อยแล้ว'
        });

    } catch (error){
        console.error('Error approving found item', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการอนุมัติ'
        });
    }
});

// 3. Admin กดปฏิเสธ/ไม่อนุมัติ (DELETE /api/admin/rejectfound/:id)
router.delete('/rejectfound/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.query('DELETE FROM FoundItem WHERE Found_ID = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรายการที่ต้องการลบ'
            });
        }

        res.status(200).json({
            success: true,
            message: 'ปฏิเสธและลบรายการสิ่งของที่พบเรียบร้อยแล้ว'
        });

    } catch (error) {
        console.error('Error rejecting found item:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการลบรายการ'
        });
    }
});

module.exports = router;