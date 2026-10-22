const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ฟังก์ชันประมวลผลจับคู่สิ่งของ (service/matchingService.js)
const { processMatchingByLostItem, processMatchingByFoundItem } = require('../service/matchingService');
const { validateLostItemReport, validateFoundItemReport, validateAdminFoundItemRecord, validateStudentId } = require('../utils/validators');
const { requireAdmin } = require('../utils/admintoken');
const { FOUND_EXPIRE_MINUTES, MESSAGES: FOUND_MESSAGES } = require('../service/foundstatus');
const { parseImageDataUrl, saveImage, removeUpload } = require('../utils/imageupload');
const { notifyAllAdmins } = require('../utils/adminnotify');

// สถานะรายการจับคู่ เมื่อผู้ใช้ยกเลิกรายการสิ่งของที่หาย (ENUM ของ MatchItem.Match_status)
const MATCH_LOST_CANCELLED = 'ผู้ใช้ยกเลิกรายการสิ่งของที่หาย';

// รหัสที่เป็นเลขจำนวนเต็มบวก (รับได้ทั้งตัวเลขและข้อความตัวเลข) ไม่ใช่ → null
function toPositiveId(value) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// 1. API แจ้งสิ่งของที่หาย (POST /api/items/lostitem) ใช้กับหน้า App-user/reportlost.html
// body (JSON): { User_ID, LostItem_name, Category_ID, Location_ID, Lost_date: 'YYYY-MM-DD', Lost_time?: 'HH:MM' (ไม่บังคับ),
//                Lost_description, Lost_photo?: 'data:image/jpeg;base64,...' (ไม่บังคับ) }
//   ไม่กรอกเวลา → Lost_time เป็น NULL (หน้าเว็บแสดงเป็น "ไม่ระบุเวลา")
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
                values.Lost_time || null,
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
        await notifyAllAdmins(connection, { Found_ID: newFoundId }, FOUND_MESSAGES.adminNew(values.FoundItem_name));

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

// 3. Admin บันทึกสิ่งของที่พบแทนนักศึกษาที่นำของมาส่งที่ส่วนกลาง (POST /api/items/founditem/admin)
//    ใช้กับหน้า Web-Admin/recordfound.html ต้องเข้าสู่ระบบ Admin: header Authorization: Bearer <token> (Admin_ID มาจาก token)
// body (JSON): { Student_ID, FoundItem_name, Category_ID, Location_ID, Found_date: 'YYYY-MM-DD', Found_time: 'HH:MM',
//                Found_description, Found_photo: 'data:image/jpeg;base64,...' (บังคับ) }   ← เหมือนผู้ใช้แจ้งเอง + รหัสนักศึกษา
// 201 = บันทึกลง FoundItem สถานะ 'อนุมัติแล้ว' ทันที (Admin_ID = ผู้บันทึก) + แจ้งเตือนนักศึกษาผู้นำของมาส่ง
//       แล้วเริ่มจับคู่กับสิ่งของที่หายทันที (ถ้า Match Score มากกว่า 70 จะแจ้งเตือน Admin "พบรายการจับคู่สิ่งของรายการใหม่")
// 400 = ข้อมูลไม่ถูกต้อง { message, errors: { ชื่อฟิลด์: ข้อความ } }, 404 (code STUDENT_NOT_FOUND) = ไม่พบรหัสนักศึกษาในระบบ
router.post('/founditem/admin', requireAdmin, async (req, res) => {
    const { values, errors } = validateAdminFoundItemRecord(req.body || {});

    let image = null;
    if (values.Found_photo) {
        image = parseImageDataUrl(values.Found_photo);
        if (image.error) errors.Found_photo = image.error;
    }
    if (Object.keys(errors).length > 0) {
        return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
    }

    let connection;
    let photoPath = null;
    let inTransaction = false;
    let newFoundId;
    let student;
    let notiMessage;
    try {
        connection = await db.getConnection();

        const [[admin]] = await connection.query('SELECT Admin_ID FROM Admin WHERE Admin_ID = ?', [req.admin.Admin_ID]);
        if (!admin) {
            return res.status(401).json({ success: false, code: 'ADMIN_UNAUTHORIZED', message: 'ไม่พบบัญชีผู้ดูแลระบบ กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
        }

        // นักศึกษาผู้นำของมาส่ง ต้องมีบัญชีในระบบ (FoundItem.User_ID ต้องอ้างถึงผู้ใช้จริง)
        [[student]] = await connection.query(
            'SELECT User_ID, Student_ID, FName, LName FROM User WHERE Student_ID = ?',
            [values.Student_ID]
        );
        const refErrors = {};
        if (!student) refErrors.Student_ID = 'ไม่พบรหัสนักศึกษานี้ในระบบ กรุณาให้นักศึกษาสมัครใช้งานแอปพลิเคชันก่อน หรือตรวจสอบรหัสอีกครั้ง';
        const [[exists]] = await connection.query(
            `SELECT EXISTS(SELECT 1 FROM Category WHERE Category_ID = ?) AS category,
                    EXISTS(SELECT 1 FROM Location WHERE Location_ID = ?) AS location`,
            [values.Category_ID, values.Location_ID]
        );
        if (!exists.category) refErrors.Category_ID = 'ไม่พบหมวดหมู่ที่เลือก กรุณาเลือกใหม่';
        if (!exists.location) refErrors.Location_ID = 'ไม่พบสถานที่ที่เลือก กรุณาเลือกใหม่';
        if (Object.keys(refErrors).length > 0) {
            return res.status(student ? 400 : 404).json({
                success: false,
                ...(student ? {} : { code: 'STUDENT_NOT_FOUND' }),
                message: Object.values(refErrors)[0],
                errors: refErrors
            });
        }

        photoPath = saveImage(image, 'found'); // บันทึกรูปลง Backend/uploads แล้วเก็บแค่ path ในฐานข้อมูล

        // บันทึกสิ่งของที่พบ (อนุมัติแล้ว) + แจ้งเตือนนักศึกษา พร้อมกัน
        await connection.beginTransaction();
        inTransaction = true;
        const [result] = await connection.query(
            `INSERT INTO FoundItem (User_ID, Admin_ID, Category_ID, Location_ID, FoundItem_name, Found_date, Found_time, Found_description, Found_photo, Found_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'อนุมัติแล้ว')`,
            [
                student.User_ID,
                admin.Admin_ID,
                values.Category_ID,
                values.Location_ID,
                values.FoundItem_name,
                values.Found_date,
                values.Found_time,
                values.Found_description,
                photoPath
            ]
        );
        newFoundId = result.insertId;
        notiMessage = FOUND_MESSAGES.recordedByAdmin(values.FoundItem_name);
        await connection.query(
            'INSERT INTO Notification (User_ID, Found_ID, Message) VALUES (?, ?, ?)',
            [student.User_ID, newFoundId, notiMessage]
        );
        await connection.commit();
        inTransaction = false;
    } catch (error) {
        if (inTransaction) await connection.rollback().catch(() => {});
        removeUpload(photoPath);
        console.error('Error recording found item by admin:', error);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกสิ่งของที่พบ กรุณาลองใหม่อีกครั้ง' });
    } finally {
        if (connection) connection.release();
    }

    // เริ่มจับคู่กับสิ่งของที่หายทันที (ถ้าจับคู่ไม่สำเร็จ การบันทึกยังมีผลตามปกติ)
    let matchIds = [];
    try {
        matchIds = (await processMatchingByFoundItem(newFoundId)) || [];
    } catch (error) {
        console.error('Error matching recorded found item:', error);
    }

    res.status(201).json({
        success: true,
        message: 'บันทึกรายการสิ่งของที่พบสำเร็จ',
        Found_ID: newFoundId,
        Found_status: 'อนุมัติแล้ว',
        Found_photo: photoPath,
        student: { Student_ID: student.Student_ID, FName: student.FName, LName: student.LName },
        notification: { Message: notiMessage },
        matches: { count: matchIds.length, Match_IDs: matchIds }
    });
});

// 3.1 ตรวจรหัสนักศึกษาก่อนบันทึก (GET /api/items/founditem/admin/student/:studentId) ให้ Admin เห็นชื่อผู้นำของมาส่ง
// 200 = { student: { Student_ID, FName, LName } }, 404 (code STUDENT_NOT_FOUND)
router.get('/founditem/admin/student/:studentId', requireAdmin, async (req, res) => {
    const studentId = String(req.params.studentId || '').trim();
    const error = validateStudentId(studentId);
    if (error) return res.status(400).json({ success: false, message: error });
    try {
        const [[student]] = await db.query('SELECT Student_ID, FName, LName FROM User WHERE Student_ID = ?', [studentId]);
        if (!student) {
            return res.status(404).json({ success: false, code: 'STUDENT_NOT_FOUND', message: 'ไม่พบรหัสนักศึกษานี้ในระบบ' });
        }
        res.json({ success: true, student });
    } catch (err) {
        console.error('Error looking up student:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบรหัสนักศึกษา' });
    }
});

// 4. API ผู้ใช้งานยกเลิกรายการสิ่งของที่หาย (DELETE /api/items/lostitem/:lostId)
// ส่ง User_ID มาด้วย (body JSON { User_ID } หรือ ?User_ID=) ยกเลิกได้เฉพาะรายการของตัวเอง
// ยกเลิกได้เมื่อสถานะ 'ไม่พบ' หรือ 'พบ' ที่ยังไม่มีคำขอรับคืนค้างอยู่ → 'ยกเลิกรายการ' + แจ้งเตือนผู้ใช้ (ไม่ลบข้อมูล)
// รายการจับคู่ของสิ่งของชิ้นนี้ที่ยังไม่จบ → Match_status 'ผู้ใช้ยกเลิกรายการสิ่งของที่หาย'
// 200 = ยกเลิกแล้ว, 400 = ข้อมูลไม่ครบ, 404 = ไม่พบรายการของผู้ใช้นี้
// 409 code: NOT_CANCELLABLE (สถานะยกเลิกไม่ได้แล้ว), CLAIM_IN_PROGRESS (มีคำขอรับคืนที่รอดำเนินการ)
router.delete('/lostitem/:lostId', async (req, res) => {
    const lostId = toPositiveId(req.params.lostId);
    const userId = toPositiveId((req.body || {}).User_ID ?? req.query.User_ID);
    if (!lostId || !userId) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. รายการต้องเป็นของผู้ใช้คนนี้ (ล็อกไว้กันการเปลี่ยนสถานะพร้อมกัน)
        const [[lostItem]] = await connection.query(
            'SELECT Lost_ID, LostItem_name, Lost_status FROM LostItem WHERE Lost_ID = ? AND User_ID = ? FOR UPDATE',
            [lostId, userId]
        );
        if (!lostItem) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบรายการสิ่งของที่หาย หรือคุณไม่มีสิทธิ์ในการยกเลิกรายการนี้' });
        }
        if (!['ไม่พบ', 'พบ'].includes(lostItem.Lost_status)) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                code: 'NOT_CANCELLABLE',
                message: `รายการนี้อยู่ในสถานะ "${lostItem.Lost_status}" ไม่สามารถยกเลิกได้`
            });
        }
        // 2. ถ้ามีคำขอรับคืนที่รออนุมัติหรืออนุมัติแล้ว ต้องให้เจ้าหน้าที่จัดการก่อน
        const [[openClaim]] = await connection.query(
            `SELECT c.Claim_ID FROM Claim c
             JOIN MatchItem m ON c.Match_ID = m.Match_ID
             WHERE m.Lost_ID = ? AND c.Claim_status IN ('รอการอนุมัติ', 'อนุมัติ') LIMIT 1`,
            [lostId]
        );
        if (openClaim) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                code: 'CLAIM_IN_PROGRESS',
                message: 'รายการนี้มีคำขอรับสิ่งของคืนที่กำลังดำเนินการอยู่ กรุณาติดต่อที่ส่วนกลาง'
            });
        }

        // 3. เปลี่ยนสถานะเป็น 'ยกเลิกรายการ' + แจ้งเตือนผู้ใช้ (ระบบจะไม่จับคู่รายการนี้อีก)
        await connection.query("UPDATE LostItem SET Lost_status = 'ยกเลิกรายการ' WHERE Lost_ID = ?", [lostId]);
        // รายการจับคู่ของสิ่งของชิ้นนี้ที่ยังไม่จบ (รอ Admin ตรวจสอบ หรือส่งให้ผู้ใช้แล้วแต่ยังไม่ได้ขอรับคืน)
        // → 'ผู้ใช้ยกเลิกรายการสิ่งของที่หาย' (ปิดอีเมลของรายการนั้นด้วย) คู่ที่จบไปแล้วคงสถานะเดิมไว้เป็นประวัติ
        await connection.query(
            `UPDATE MatchItem SET Match_status = ?
             WHERE Lost_ID = ? AND (Match_status IS NULL OR Match_status = 'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน')`,
            [MATCH_LOST_CANCELLED, lostId]
        );
        // การแจ้งเตือน "พบรายการจับคู่ใหม่" ของ Admin สำหรับคู่เหล่านั้น ไม่ต้องจัดการแล้ว → อ่านแล้ว
        await connection.query(
            `UPDATE Notification n JOIN MatchItem m ON m.Match_ID = n.Match_ID
             SET n.Is_read = TRUE
             WHERE m.Lost_ID = ? AND m.Match_status = ? AND n.Admin_ID IS NOT NULL AND n.Is_read = FALSE`,
            [lostId, MATCH_LOST_CANCELLED]
        );
        const notiMessage = `ท่านได้ทำการยกเลิกรายการสิ่งของ "${lostItem.LostItem_name}" เรียบร้อยแล้ว`;
        await connection.query(
            'INSERT INTO Notification (User_ID, Lost_ID, Message) VALUES (?, ?, ?)',
            [userId, lostId, notiMessage]
        );
        await connection.commit();

        res.status(200).json({
            success: true,
            message: 'ยกเลิกรายการสิ่งของที่หายเรียบร้อยแล้ว',
            Lost_ID: lostId,
            Lost_status: 'ยกเลิกรายการ'
        });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        console.error('Error canceling lost item:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการยกเลิกรายการสิ่งของที่หาย'
        });
    } finally {
        if (connection) connection.release();
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