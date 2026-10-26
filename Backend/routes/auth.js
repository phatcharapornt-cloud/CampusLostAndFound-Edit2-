const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { validateRegistration, validateLogin } = require('../utils/validators');
// เก็บรหัสผ่านเป็นข้อความตามที่กรอก (ไม่ hash) ดูรายละเอียดใน utils/password.js
const { toStoredPassword, verifyPassword } = require('../utils/password');

//1. API สมัครสมาชิก (POST /api/auth/register(signup))
     // Body (JSON): { FName, LName, Student_ID, Email, Password }
     // 201 = สมัครสำเร็จ | 400 = ข้อมูลไม่ผ่านเงื่อนไข (errors แยกตามฟิลด์) | 409 = รหัสนักศึกษา/อีเมลซ้ำ
router.post('/register', async (req, res) => {
    // 1. ตรวจสอบความถูกต้องของข้อมูล (ชื่อ, รหัสนักศึกษา 8 หลัก, อีเมล รหัสนักศึกษา@kmitl.ac.th, เงื่อนไขรหัสผ่าน)
    const { values, errors } = validateRegistration(req.body ?? {});

    if (Object.keys(errors).length > 0) {
        const missingField = Object.values(values).some((value) => value === '');
        return res.status(400).json({
            success: false,
            message: missingField ? 'กรุณากรอกข้อมูลให้ครบถ้วน' : Object.values(errors)[0],
            errors
        });
    }

    const { FName, LName, Student_ID, Email, Password } = values;

    try {
        // 2. ตรวจสอบว่ามี Email หรือ Student_ID เคยทำการลงทะเบียนไปแล้วหรือยัง
        const checkUserQuery = 'SELECT Student_ID, Email FROM User WHERE Email = ? OR Student_ID = ?';
        const [existingUser] = await db.query(checkUserQuery, [Email, Student_ID]);

        if (existingUser.length > 0) {
            const duplicateErrors = {};
            if (existingUser.some((user) => user.Student_ID === Student_ID)) {
                duplicateErrors.Student_ID = 'รหัสนักศึกษานี้ได้ทำการลงทะเบียนแล้ว';
            }
            if (existingUser.some((user) => user.Email.toLowerCase() === Email)) {
                duplicateErrors.Email = 'อีเมลนี้ได้ทำการลงทะเบียนแล้ว';
            }
            return res.status(409).json({
                success: false,
                message: 'อีเมลหรือรหัสนักศึกษานี้ได้ทำการลงทะเบียนแล้ว',
                errors: duplicateErrors
            });
        }

        // 3. บันทึกข้อมูลผู้ใช้ใหม่ลงในตาราง User (รหัสผ่านเก็บตามที่กรอก ไม่ hash)
        const insertUserQuery = 'INSERT INTO User (FName, LName, Student_ID, Email, Password) VALUES (?, ?, ?, ?, ?)';
        const [result] = await db.query(insertUserQuery, [FName, LName, Student_ID, Email, toStoredPassword(Password)]);

        // 5. ส่งผลลัพธ์กลับไปยังผู้ใช้
        res.status(201).json({
            success: true,
            message: 'ลงทะเบียนสำเร็จ',
            userId: result.insertId
        });

    } catch (error) {
        // กรณีมีคนสมัครด้วยข้อมูลเดียวกันพร้อมกัน ฐานข้อมูลจะปฏิเสธเพราะคอลัมน์เป็น UNIQUE
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'อีเมลหรือรหัสนักศึกษานี้ได้ทำการลงทะเบียนแล้ว'
            });
        }
        console.error('Register error:', error);
        res.status(500).json({ 
            success: false,
            message: 'เกิดข้อผิดพลาดในการลงทะเบียน' 
        });
    }
});

// 2. API เข้าสู่ระบบ (POST /api/auth/login)
// ผู้ใช้งาน (App-user): Body { Student_ID, Password }
//   200 = สำเร็จ (role: 'user', user: ข้อมูลผู้ใช้ไม่รวมรหัสผ่าน) | 400 = กรอกไม่ครบ/รูปแบบผิด | 401 = รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง
// แบบเดิม: Body { Email, Password } ยังใช้ได้ (ผู้ใช้งานหรือ Admin เข้าด้วยอีเมล)
router.post('/login', (req, res) => loginWithStudentId(req.body ?? {}, res));

// เข้าสู่ระบบด้วยรหัสนักศึกษา + รหัสผ่าน (ใช้ในหน้า App-user/login.html)
async function loginWithStudentId(body, res) {
    // 1. ตรวจสอบว่ากรอกครบ และรหัสนักศึกษาเป็นตัวเลข 8 หลัก
    const { values, errors } = validateLogin(body);

    if (Object.keys(errors).length > 0) {
        const missingField = values.Student_ID === '' || values.Password === '';
        return res.status(400).json({
            success: false,
            message: missingField ? 'กรุณากรอกรหัสนักศึกษาและรหัสผ่านให้ครบถ้วน' : Object.values(errors)[0],
            errors
        });
    }

    // ไม่บอกว่าผิดที่รหัสนักศึกษาหรือรหัสผ่าน เพื่อไม่ให้คนอื่นใช้หน้านี้เดาว่าใครมีบัญชีบ้าง
    const invalidCredentials = {
        success: false,
        message: 'รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง'
    };

    try {
        // 2. ค้นหาผู้ใช้จากรหัสนักศึกษา
        const getUserQuery = 'SELECT User_ID, FName, LName, Student_ID, Email, Password FROM User WHERE Student_ID = ?';
        const [users] = await db.query(getUserQuery, [values.Student_ID]);

        if (users.length === 0) {
            return res.status(401).json(invalidCredentials);
        }

        // 3. เปรียบเทียบรหัสผ่านที่กรอกกับรหัสผ่านที่เก็บไว้ในฐานข้อมูล
        const user = users[0];
        if (!verifyPassword(values.Password, user.Password)) {
            return res.status(401).json(invalidCredentials);
        }

        // 4. ส่งข้อมูลผู้ใช้กลับไป (ลบ Password ออกก่อน)
        const { Password: _, ...userWithoutPassword } = user;
        return res.status(200).json({
            success: true,
            message: 'เข้าสู่ระบบสำเร็จ',
            role: 'user',
            user: userWithoutPassword
        });
    } catch (error) {
        console.error('Login (Student_ID) error:', error);
        return res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ'
        });
    }
}

module.exports = router;