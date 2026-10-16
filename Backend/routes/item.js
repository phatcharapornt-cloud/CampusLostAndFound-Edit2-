const express = require('express');
const router = express.Router();
const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// นำเข้าฟังก์ชันประมวลผลจับคู่จากไฟล์ matchitem.js
const { processMatchingByLostItem, processMatchingByFoundItem } = require('../service/matchingservice');
const { validateLostItemReport, validateFoundItemReport } = require('../utils/validators');
const { FOUND_EXPIRE_MINUTES, MESSAGES: FOUND_MESSAGES } = require('../service/foundstatus');
const { parseImageDataUrl, saveImage, removeUpload } = require('../utils/imageupload');

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

// 1. API แจ้งสิ่งของที่หาย (POST /api/items/lostitem) ใช้กับหน้า App-user/reportlost.html
// body (JSON): { User_ID, LostItem_name, Category_ID, Location_ID, Lost_date: 'YYYY-MM-DD', Lost_time: 'HH:MM',
//                Lost_description, Lost_photo?: 'data:image/jpeg;base64,...' (ไม่บังคับ) }
// 201 = บันทึกลงตาราง LostItem (สถานะ 'ไม่พบ') + บันทึกการแจ้งเตือนลงตาราง Notification แล้ว
// 400 = ข้อมูลไม่ถูกต้อง { message, errors: { ชื่อฟิลด์: ข้อความ } }, 404 = ไม่พบบัญชีผู้ใช้
router.post('/lostitem', async (req, res) => {
    const { values, errors } = validateLostItemReport(req.body || {});

    // รูปภาพไม่บังคับ แต่ถ้าแนบมาต้องเป็นไฟล์รูปที่ถูกต้อง
    let image = null;
    if (values.Lost_photo) {
        image = parseImageDataUrl(values.Lost_photo);
        if (image.error) errors.Lost_photo = image.error;
    }

    if (Object.keys(errors).length > 0) {
        return res.status(400).json({
            success: false,
            message: Object.values(errors)[0],
            errors
        });
    }

    let connection;
    let photoPath = null;
    let inTransaction = false;
    try {
        connection = await db.getConnection();

        // ตรวจว่าผู้ใช้ หมวดหมู่ และสถานที่ มีอยู่จริงในระบบ
        const [[exists]] = await connection.query(
            `SELECT
                EXISTS(SELECT 1 FROM User WHERE User_ID = ?) AS user,
                EXISTS(SELECT 1 FROM Category WHERE Category_ID = ?) AS category,
                EXISTS(SELECT 1 FROM Location WHERE Location_ID = ?) AS location`,
            [values.User_ID, values.Category_ID, values.Location_ID]
        );
        if (!exists.user) {
            return res.status(404).json({
                success: false,
                code: 'USER_NOT_FOUND',
                message: 'ไม่พบบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่อีกครั้ง'
            });
        }
        const refErrors = {};
        if (!exists.category) refErrors.Category_ID = 'ไม่พบหมวดหมู่ที่เลือก กรุณาเลือกใหม่';
        if (!exists.location) refErrors.Location_ID = 'ไม่พบสถานที่ที่เลือก กรุณาเลือกใหม่';
        if (Object.keys(refErrors).length > 0) {
            return res.status(400).json({ success: false, message: Object.values(refErrors)[0], errors: refErrors });
        }

        if (image) photoPath = saveImage(image, 'lost'); // บันทึกรูปลง Backend/uploads แล้วเก็บแค่ path ในฐานข้อมูล

        // บันทึกสิ่งของที่หาย + การแจ้งเตือน พร้อมกัน (ถ้าอย่างใดอย่างหนึ่งไม่สำเร็จ จะยกเลิกทั้งคู่)
        await connection.beginTransaction();
        inTransaction = true;

        const [result] = await connection.query(
            `INSERT INTO LostItem (User_ID, Category_ID, Location_ID, LostItem_name, Lost_date, Lost_time, Lost_description, Lost_photo, Lost_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ไม่พบ')`,
            [
                values.User_ID,
                values.Category_ID,
                values.Location_ID,
                values.LostItem_name,
                values.Lost_date,
                values.Lost_time,
                values.Lost_description,
                photoPath
            ]
        );
        const newLostId = result.insertId;

        // ข้อความแจ้งเตือนเก็บในตาราง Notification (Message VARCHAR(200): ชื่อสิ่งของยาวสุด 100 ตัวอักษร จึงไม่เกิน)
        const notiMessage = `ท่านได้ทำการแจ้งสิ่งของที่หายสำเร็จ "${values.LostItem_name}" ระบบจะแจ้งเตือนเมื่อพบสิ่งของที่ตรงกัน`;
        const [notiResult] = await connection.query(
            'INSERT INTO Notification (User_ID, Lost_ID, Message) VALUES (?, ?, ?)',
            [values.User_ID, newLostId, notiMessage]
        );

        await connection.commit();
        inTransaction = false;

        // เริ่มจับคู่กับสิ่งของที่พบในระบบอัตโนมัติ (ทำเบื้องหลัง ไม่ต้องรอ)
        processMatchingByLostItem(newLostId);

        res.status(201).json({
            success: true,
            message: 'ท่านได้ทำการแจ้งสิ่งของที่หายสำเร็จ',
            Lost_ID: newLostId,
            LostItem_ID: newLostId, // ชื่อเดิม (เผื่อโค้ดเก่าที่ยังใช้อยู่)
            Lost_photo: photoPath,
            notification: {
                Notification_ID: notiResult.insertId,
                Message: notiMessage
            }
        });
    } catch (error) {
        if (inTransaction) await connection.rollback().catch(() => {});
        removeUpload(photoPath);
        console.error('Error reporting lost item:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการแจ้งสิ่งของที่หาย กรุณาลองใหม่อีกครั้ง'
        });
    } finally {
        if (connection) connection.release();
    }
});

// 2. API แจ้งสิ่งของที่พบโดยผู้ใช้งาน (POST /api/items/founditem/user) ใช้กับหน้า App-user/reportfound.html
// body (JSON): { User_ID, FoundItem_name, Category_ID, Location_ID, Found_date: 'YYYY-MM-DD', Found_time: 'HH:MM',
//                Found_description, Found_photo: 'data:image/jpeg;base64,...' (บังคับ) }
// 201 = บันทึกลงตาราง FoundItem (สถานะ 'รอการอนุมัติ') + แจ้งเตือนผู้ใช้งาน + แจ้งเตือน Admin ทุกคน ("มีรายการแจ้งสิ่งของที่พบเข้ามาใหม่")
//       ต้องนำสิ่งของมาส่งที่ส่วนกลางภายใน 30 นาที ไม่อย่างนั้นระบบจะเปลี่ยนเป็น 'ถูกปฏิเสธ' (service/foundstatus.js)
// 400 = ข้อมูลไม่ถูกต้อง { message, errors: { ชื่อฟิลด์: ข้อความ } }, 404 = ไม่พบบัญชีผู้ใช้
router.post('/founditem/user', async (req, res) => {
    const { values, errors } = validateFoundItemReport(req.body || {});

    let image = null;
    if (values.Found_photo) {
        image = parseImageDataUrl(values.Found_photo);
        if (image.error) errors.Found_photo = image.error;
    }

    if (Object.keys(errors).length > 0) {
        return res.status(400).json({
            success: false,
            message: Object.values(errors)[0],
            errors
        });
    }

    let connection;
    let photoPath = null;
    let inTransaction = false;
    try {
        connection = await db.getConnection();

        // ตรวจว่าผู้ใช้ หมวดหมู่ และสถานที่ มีอยู่จริงในระบบ
        const [[exists]] = await connection.query(
            `SELECT
                EXISTS(SELECT 1 FROM User WHERE User_ID = ?) AS user,
                EXISTS(SELECT 1 FROM Category WHERE Category_ID = ?) AS category,
                EXISTS(SELECT 1 FROM Location WHERE Location_ID = ?) AS location`,
            [values.User_ID, values.Category_ID, values.Location_ID]
        );
        if (!exists.user) {
            return res.status(404).json({
                success: false,
                code: 'USER_NOT_FOUND',
                message: 'ไม่พบบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่อีกครั้ง'
            });
        }
        const refErrors = {};
        if (!exists.category) refErrors.Category_ID = 'ไม่พบหมวดหมู่ที่เลือก กรุณาเลือกใหม่';
        if (!exists.location) refErrors.Location_ID = 'ไม่พบสถานที่ที่เลือก กรุณาเลือกใหม่';
        if (Object.keys(refErrors).length > 0) {
            return res.status(400).json({ success: false, message: Object.values(refErrors)[0], errors: refErrors });
        }

        photoPath = saveImage(image, 'found'); // บันทึกรูปลง Backend/uploads แล้วเก็บแค่ path ในฐานข้อมูล

        // บันทึกสิ่งของที่พบ + การแจ้งเตือนผู้ใช้ + การแจ้งเตือน Admin พร้อมกัน (ไม่สำเร็จอย่างใดอย่างหนึ่ง ยกเลิกทั้งหมด)
        await connection.beginTransaction();
        inTransaction = true;

        const [result] = await connection.query(
            `INSERT INTO FoundItem (User_ID, Admin_ID, Category_ID, Location_ID, FoundItem_name, Found_date, Found_time, Found_description, Found_photo, Found_status)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'รอการอนุมัติ')`,
            [
                values.User_ID,
                values.Category_ID,
                values.Location_ID,
                values.FoundItem_name,
                values.Found_date,
                values.Found_time,
                values.Found_description,
                photoPath
            ]
        );
        const newFoundId = result.insertId;

        const notiMessage = FOUND_MESSAGES.reported(values.FoundItem_name);
        const [notiResult] = await connection.query(
            'INSERT INTO Notification (User_ID, Found_ID, Message) VALUES (?, ?, ?)',
            [values.User_ID, newFoundId, notiMessage]
        );

        // แจ้งเตือน Admin ทุกคน (ตาราง Notification ผูกกับ Admin_ID ทีละคน)
        await connection.query(
            'INSERT INTO Notification (Admin_ID, Found_ID, Message) SELECT Admin_ID, ?, ? FROM Admin',
            [newFoundId, FOUND_MESSAGES.adminNew(values.FoundItem_name)]
        );

        // เวลาที่ต้องนำสิ่งของมาส่งภายใน (นับจากเวลาที่แจ้ง ตามเวลาของฐานข้อมูล)
        const [[deadline]] = await connection.query(
            `SELECT DATE_FORMAT(Foundcheck_at + INTERVAL ? MINUTE, '%Y-%m-%d %H:%i:%s') AS deliverBy FROM FoundItem WHERE Found_ID = ?`,
            [FOUND_EXPIRE_MINUTES, newFoundId]
        );

        await connection.commit();
        inTransaction = false;

        res.status(201).json({
            success: true,
            message: 'ท่านได้ทำการแจ้งสิ่งของที่พบสำเร็จ',
            Found_ID: newFoundId,
            FoundItem_ID: newFoundId, // ชื่อเดิม (เผื่อโค้ดเก่าที่ยังใช้อยู่)
            Found_status: 'รอการอนุมัติ',
            Found_photo: photoPath,
            deliverWithinMinutes: FOUND_EXPIRE_MINUTES,
            deliverBy: deadline.deliverBy,
            notification: {
                Notification_ID: notiResult.insertId,
                Message: notiMessage
            }
        });
    } catch (error) {
        if (inTransaction) await connection.rollback().catch(() => {});
        removeUpload(photoPath);
        console.error('Error reporting found item by user:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการแจ้งสิ่งของที่พบ กรุณาลองใหม่อีกครั้ง'
        });
    } finally {
        if (connection) connection.release();
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

        // บันทึกการแจ้งเตือน เมื่อAdminทำการแจ้งสิ่งของที่พบสำเร็จ
        const adminNotiMessage = `บันทึกรายการสิ่งของที่พบ "${FoundItem_name}" สำเร็จแล้ว`;
        await db.query(
            `INSERT INTO Notification (Admin_ID, Found_ID, Message) VALUES (?, ?, ?)`,
            [Admin_ID, newFoundId, adminNotiMessage]
        );

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
        // 1. ค้นหาข้อมูลรายการของหายก่อน เพื่อดึง User_ID และชื่อสิ่งของมาทำ Notification
        let selectQuery = 'SELECT User_ID, LostItem_name FROM LostItem WHERE Lost_ID = ?';
        let selectParams = [lostId];

        if (User_ID) {
            selectQuery += ' AND User_ID = ?';
            selectParams.push(User_ID);
        }

        const [items] = await db.query(selectQuery, selectParams);

        if (items.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรายการสิ่งของที่หาย หรือคุณไม่มีสิทธิ์ในการยกเลิกรายการนี้'
            });
        }

        const lostItem = items[0];
        const targetUserId = User_ID || lostItem.User_ID;

        // 2. อัปเดตสถานะของสิ่งของที่หายเป็น 'ยกเลิกรายการ' 
        await db.query("UPDATE LostItem SET Lost_status = 'ยกเลิกรายการ' WHERE Lost_ID = ?", [lostId]);

        // 3. บันทึก Notification แจ้งเตือนไปยังผู้ใช้งาน 
        const notiMessage = `ท่านได้ทำการยกเลิกรายการสิ่งของ "${lostItem.LostItem_name}" เรียบร้อยแล้ว`;
        await db.query(
            `INSERT INTO Notification (User_ID, Lost_ID, Message) VALUES (?, ?, ?)`,
            [targetUserId, lostId, notiMessage]
        );

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