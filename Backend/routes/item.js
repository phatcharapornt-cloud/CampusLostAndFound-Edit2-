const express = require('express');
const router = express.Router();
const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// นำเข้าฟังก์ชันประมวลผลจับคู่จากไฟล์ matchitem.js
const { processMatchingByLostItem, processMatchingByFoundItem } = require('../service/matchingService');

// ฟังก์ชันแปลง Base64 แล้วบันทึกเป็นไฟล์รูปภาพลงโฟลเดอร์ uploads
function saveBase64Image(base64Data, prefix) {
    if (!base64Data) return null;
    
    // ตรวจจับ Data URI (jpeg, png, jpg, gif)
    const matches = base64Data.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches) return null;

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const data = matches[2];
    const fileName = `${prefix}_${Date.now()}.${ext}`;
    const filePath = path.join(__dirname, '../uploads', fileName);

    // บันทึกไฟล์รูปจริงลงในโฟลเดอร์ Backend/uploads
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

    // คืนค่าเฉพาะ Path สั้นๆ สำหรับเซฟลง Database
    return `/uploads/${fileName}`;
}

// 1. API แจ้งสิ่งของที่หาย (POST /api/items/lostitem)
router.post('/lostitem', async (req, res) => {
    const{
        User_ID,
        Category_ID,
        Location_ID,
        LostItem_name,
        Lost_date,
        Lost_time,
        Lost_description,
        Lost_photo,
    } = req.body;

    // ตรวจสอบว่ากรอกข้อมูลครบถ้วนหรือไม่
    if (!User_ID || !Category_ID || !Location_ID || !LostItem_name || !Lost_date || !Lost_description ) {
        return res.status(400).json({ 
            success: false, 
            message: 'กรุณากรอกข้อมูลให้ครบถ้วน' 
        });
    }

    try {
        const status = 'ไม่พบ'; // กำหนดสถานะเริ่มต้นเป็น 'ไม่พบ'
        const time = Lost_time || null ; // กำหนดค่า default เป็น null หากผู้ใช้งานจำช่วงเวลาของสิ่งของที่หายไม่ได้
        const photoPath = saveBase64Image(Lost_photo, 'lost'); // บันทึกรูปภาพลงดิสก์ แล้วดึง Path สั้นๆ มาใช้งาน

        // 1. บันทึกข้อมูลสิ่งของที่หายลงในตาราง LostItem
        const insertLostItemQuery = `
            INSERT INTO LostItem (User_ID, Category_ID, Location_ID, LostItem_name, Lost_date, Lost_time, Lost_description, Lost_photo, Lost_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
       
        const [result] = await db.query(insertLostItemQuery, [
            User_ID, 
            Category_ID, 
            Location_ID, 
            LostItem_name, 
            Lost_date, 
            time, 
            Lost_description, 
            photoPath, 
            status
        ]);

        const newLostId = result.insertId; //ดึง Lost_ID ที่ถูกบันทึกล่าสุด

        // เรียกฟังก์ชันประมวลผลการจับคู่สิ่งของให้อัตโนมัติ
        processMatchingByLostItem(newLostId);

        res.status(201).json({
            success: true,
            message: 'แจ้งสิ่งของที่หายสำเร็จ',
            LostItem_ID: newLostId // ส่งกลับ LostItem_ID ของสิ่งของที่หายที่ถูกบันทึก
        });
    } catch (error) {
        console.error('Error reporting lost item:', error);
        res.status(500).json({ 
            success: false, 
            message: 'เกิดข้อผิดพลาดในการแจ้งสิ่งของที่หาย' 
        });             
    }
});

// 2. API แจ้งสิ่งของที่พบโดยผู้ใช้งาน(user) (POST /api/items/founditem/user)
router.post('/founditem/user', async (req, res) => {
    const{
        User_ID, // User_ID ของคนที่ล็อกอินมาแจ้ง
        Category_ID,
        Location_ID,
        FoundItem_name,
        Found_date,
        Found_time,
        Found_description,
        Found_photo,
    } = req.body;   

    // ตรวจสอบว่ากรอกข้อมูลครบถ้วนหรือไม่
    if (!User_ID ||!Category_ID || !Location_ID || !FoundItem_name || !Found_date || !Found_time || !Found_photo || !Found_description ) {
        return res.status(400).json({
            success: false,
            message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
        });
    }

    try {
        const status = 'รอการอนุมัติ';
        const adminID = null; // ผู้ใช้แจ้งเอง ยังไม่มี Admin อนุมัติ
        const photoPath = saveBase64Image(Found_photo, 'found');

        const insertFoundItemQuery = `
            INSERT INTO FoundItem (User_ID, Admin_ID, Category_ID, Location_ID, FoundItem_name, Found_date, Found_time, Found_description, Found_photo, Found_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [result] = await db.query(insertFoundItemQuery, [
            User_ID,
            adminID,
            Category_ID,
            Location_ID,
            FoundItem_name,
            Found_date,
            Found_time,
            Found_description,
            photoPath,
            status
        ]);

        res.status(201).json({
            success: true,
            message: 'แจ้งสิ่งของที่พบสำเร็จ (รอ Admin อนุมัติ)',
            FoundItem_ID: result.insertId
        });
    } catch (error) {
        console.error('Error reporting found item by user:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการแจ้งสิ่งของที่พบ'
        });
    }
});

// 3. API แจ้งสิ่งของที่พบโดยผู้ดูแล (admin) (POST /api/items/founditem/admin)
router.post('/founditem/admin', async (req, res) => {
    const {
        Admin_ID,     // Admin ที่เข้าสู่ระบบ
        Student_ID,   // รหัสนักศึกษาของผู้นำของมาคืน (Admin กรอก)
        Category_ID,
        Location_ID,
        FoundItem_name,
        Found_date,
        Found_time,
        Found_description,
        Found_photo,
    } = req.body;   

    if (!Admin_ID || !Student_ID || !Category_ID || !Location_ID || !FoundItem_name || !Found_date || !Found_time || !Found_photo || !Found_description) {
        return res.status(400).json({
            success: false,
            message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
        });
    }

    try {
        // ค้นหา User_ID จาก Student_ID ที่ Admin กรอกเข้ามา
        const [users] = await db.query('SELECT User_ID FROM User WHERE Student_ID = ?', [Student_ID]);

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบข้อมูลนักศึกษานี้ในระบบ กรุณาให้นักศึกษาสมัครใช้งานในแอปพลิเคชันและตรวจสอบความถูกต้องอีกครั้ง'
            });
        }

        const userID = users[0].User_ID;
        const status = 'อนุมัติแล้ว'; // Admin บันทึกเอง ถือว่าอนุมัติทันที
        const photoPath = saveBase64Image(Found_photo, 'found');

        const insertFoundItemQuery = `
            INSERT INTO FoundItem (User_ID, Admin_ID, Category_ID, Location_ID, FoundItem_name, Found_date, Found_time, Found_description, Found_photo, Found_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [result] = await db.query(insertFoundItemQuery, [
            userID,       // User_ID ของนักศึกษาคนที่นำของมาคืน
            Admin_ID,     // Admin_ID ของ Admin ผู้คีย์ข้อมูล
            Category_ID,
            Location_ID,
            FoundItem_name,
            Found_date,
            Found_time,
            Found_description,
            photoPath,
            status
        ]);

        const newFoundId = result.insertId;

        // ประมวลผลจับคู่อัตโนมัติทันที
        processMatchingByFoundItem(newFoundId);

        res.status(201).json({
            success: true,
            message: 'บันทึกสิ่งของที่พบและประมวลผลจับคู่เรียบร้อยแล้ว',
            FoundItem_ID: newFoundId
        });
    } catch (error) {
        console.error('Error reporting found item by admin:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการบันทึกสิ่งของที่พบ'
        });
    }
});

// 4. API ผู้ใช้งานยกเลิกรายการสิ่งของที่หาย (DELETE /api/items/lostitem/:lostId)
router.delete('/lostitem/:lostId', async (req, res) => {
    const { lostId } = req.params;
    const { User_ID } = req.body;

    try {
        let deleteQuery = 'DELETE FROM LostItem WHERE Lost_ID = ?';
        let queryParams = [lostId];

        if (User_ID) {
            deleteQuery += ' AND User_ID = ?';
            queryParams.push(User_ID);
        }

        const [result] = await db.query(deleteQuery, queryParams);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรายการสิ่งของที่หาย หรือคุณไม่มีสิทธิ์ในการยกเลิกรายการนี้'
            });
        }

        res.status(200).json({
            success: true,
            message: 'ยกเลิกรายการสิ่งของที่หายเรียบร้อยแล้ว'
        });

    } catch (error) {
        console.error('Error canceling lost item:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการยกเลิกรายการสิ่งของที่หาย'
        });
    }
});

// 5. API ดึงหมวดหมู่และสถานที่ (ใช้ส่งให้ Frontend ทำตัวเลข/Dropdown)

    // 1. ดึงหมวดหมู่ (GET /api/items/categories)
        router.get('/categories', async (req, res) => {
             try {
                const [categories] = await db.query('SELECT * FROM Category');
                res.json({
                    success: true,
                    categories
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: 'เกิดข้อผิดพลาดในการดึงหมวดหมู่'
                });
            }
        });

    // 2. ดึงสถานที่ (GET /api/items/locations)
        router.get('/locations', async (req, res) => {
            try {
                const [locations] = await db.query('SELECT * FROM Location');
                res.json({
                    success: true,
                    locations
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: 'เกิดข้อผิดพลาดในการดึงสถานที่'
                });
            }
        });

module.exports = router;
