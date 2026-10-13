const express = require('express');
const router = express.Router();
const db = require('../config/db');
const fs = require('fs');
const path = require('path');

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

        res.status(201).json({
            success: true,
            message: 'แจ้งสิ่งของที่หายสำเร็จ',
            LostItem_ID: result.insertId // ส่งกลับ LostItem_ID ของสิ่งของที่หายที่ถูกบันทึก
        });
    } catch (error) {
        console.error('Error reporting lost item:', error);
        res.status(500).json({ 
            success: false, 
            message: 'เกิดข้อผิดพลาดในการแจ้งสิ่งของที่หาย' 
        });             
    }
});

// 2. API แจ้งสิ่งของที่พบ (POST /api/items/founditem)
router.post('/founditem', async (req, res) => {
    const{
        User_ID,
        Admin_ID,
        Category_ID,
        Location_ID,
        FoundItem_name,
        Found_date,
        Found_time,
        Found_description,
        Found_photo,
    } = req.body;   

    // ตรวจสอบว่ากรอกข้อมูลครบถ้วนหรือไม่
    if (!Category_ID || !Location_ID || !FoundItem_name || !Found_date || !Found_time || !Found_photo || !Found_description ) {
        return res.status(400).json({
            success: false,
            message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
        });
    }

    // ต้องมีผู้แจ้งอย่างน้อย 1 คน (User หรือ Admin) หากไม่มีผู้แจ้งให้ส่ง error
    if (!User_ID && !Admin_ID) {
        return res.status(400).json({
            success: false,
            message: 'กรุณาระบุผู้แจ้ง (User หรือ Admin)'
        });
    }

    try {
        const userID = User_ID || null; // หากไม่มี User_ID ให้กำหนดเป็น null
        const adminID = Admin_ID || null; // หากไม่มี Admin_ID ให้กำหนดเป็น null

        //หาก Admin เป็นผู้แจ้งเองให้เป็น 'อนุมัติแล้ว' ทันที แต่ถ้า User แจ้งให้เป็น 'รอดำเนินการ'
        const status = adminID ? 'อนุมัติแล้ว' : 'รอการอนุมัติ';
        const photoPath = saveBase64Image(Found_photo, 'found'); // บันทึกรูปภาพลงดิสก์ แล้วดึง Path สั้นๆ มาใช้งาน

        const insertFoundItemQuery = `
            INSERT INTO FoundItem (User_ID, Admin_ID, Category_ID, Location_ID, FoundItem_name, Found_date, Found_time, Found_description, Found_photo, Found_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [result] = await db.query(insertFoundItemQuery, [
            userID,
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
            message: 'แจ้งสิ่งของที่พบสำเร็จ',
            FoundItem_ID: result.insertId // ส่งกลับ FoundItem_ID ของสิ่งของที่พบที่ถูกบันทึก
        });
    } catch (error) {
        console.error('Error reporting found item:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการแจ้งสิ่งของที่พบ'
        });
    }
});

// 3. API ดึงหมวดหมู่และสถานที่ (ใช้ส่งให้ Frontend ทำตัวเลข/Dropdown)

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
