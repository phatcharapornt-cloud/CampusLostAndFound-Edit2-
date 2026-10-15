const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { validateRegistration } = require('../utils/validators');

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

        // 3. เข้ารหัส Password ด้วย bcrypt
        const hashedPassword = await bcrypt.hash(Password, 10);

        // 4. บันทึกข้อมูลผู้ใช้ใหม่ลงในตาราง User
        const insertUserQuery = 'INSERT INTO User (FName, LName, Student_ID, Email, Password) VALUES (?, ?, ?, ?, ?)';
        const [result] = await db.query(insertUserQuery, [FName, LName, Student_ID, Email, hashedPassword]);

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
router.post('/login', async (req, res) => {
    const { Email, Password } = req.body;

    //ตรวจสอบว่ากรอกข้อมูลครบถ้วนหรือไม่
    if (!Email || !Password) {
        return res.status(400).json({
            success: false,
            message: 'กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน'
        });
    }

    try {
        //1. ตรวจสอบว่ามี Email ในฐานข้อมูล(User) หรือไม่
        const getUserQuery = 'SELECT * FROM User WHERE Email = ?';
        const [users] = await db.query(getUserQuery, [Email]);
        
        if (users.length > 0) {
            const user = users[0];
            const isPasswordValid = await bcrypt.compare(Password, user.Password);

            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
                });
            }
            // ลบ Password ออกจากข้อมูลผู้ใช้
            const { Password: _, ...userWithoutPassword } = user;
            return res.status(200).json({
                success: true,
                message: 'เข้าสู่ระบบสำเร็จ',
                role: 'user',
                user: userWithoutPassword
            });
        }

        // 2. ตรวจสอบว่ามี Email ในฐานข้อมูล(Admin) หรือไม่
        const getAdminQuery = 'SELECT * FROM Admin WHERE Admin_email = ?';
        const [admins] = await db.query(getAdminQuery, [Email]);

        if (admins.length > 0) {
            const admin = admins[0];
            // เปรียบเทียบรหัสผ่านแบบตรง ๆ สำหรับ Admin
            const isPasswordValid = (Password === admin.Admin_password)|| await bcrypt.compare(Password, admin.Admin_password).catch(() => false);  

            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
                });
            }
            const { Admin_password, ...adminWithoutPassword } = admin; // ลบ Admin_password ออกจากข้อมูลผู้ดูแลระบบ
            return res.status(200).json({
                success: true,
                message: 'เข้าสู่ระบบสำเร็จ',
                role: 'admin',
                admin: adminWithoutPassword
            });
        }

        return res.status(401).json({
            success: false,
            message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ'
        });
    }
});

// 3. API เปลี่ยนรหัสผ่าน (POST /api/auth/Resetpassword)
router.post('/request-reset', async (req, res) => {
    const {Student_ID} = req.body;

    if (!Student_ID) {
        return res.status(400).json({
            success: false,
            message: 'กรุณากรอกรหัสนักศึกษา'
        });
    }

    try {
        // ตรวจสอบว่ามี Student_ID ในฐานข้อมูล(User) หรือไม่
        const getUserQuery = 'SELECT * FROM User WHERE Student_ID = ?';
        const [users] = await db.query(getUserQuery, [Student_ID]);

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรหัสนักศึกษานี้ในระบบ'
            });
        }
        
        const user = users[0];
       // 1. สร้าง Primary Key (Resetpassword_ID) ไม่เกิน 20 ตัวอักษร
        const resetpasswordId = `RP${Date.now()}`; // ตัวอย่าง: RP1728463688000 (15 ตัวอักษร)

        // 2. สร้าง Request_code แบบสั้น (OTP 6 หลัก) เพื่อไม่ให้เกิน VARCHAR(20)
        const requestCode = Math.floor(100000 + Math.random() * 900000).toString(); 

        // 3. กำหนดวันเวลาหมดอายุ (Datetime_at) เช่น 10 นาทีถัดไป
        const datetimeAt = new Date(Date.now() + 10 * 60 * 1000); 

        // 4. บันทึกข้อมูลลงตาราง ResetPassword ตามโครงสร้าง Data Dictionary
        const insertResetPasswordQuery = 'INSERT INTO ResetPassword (Resetpassword_ID, User_ID, Request_code, Datetime_at, Is_used) VALUES (?, ?, ?, ?, FALSE)';
        const [result] = await db.query(insertResetPasswordQuery, [resetpasswordId, user.User_ID, requestCode, datetimeAt]);
        
        res.status(200).json({
            success: true,
            message: 'พบข้อมูลผู้ใช้งาน',
            email: user.Email, // ส่ง Email กลับไปยังหน้า Mockup UI
            resetToken: requestCode, // ส่ง Request_code กลับไปใช้ยืนยันในหน้า Mockup UI
        });
    } catch (error) {
        console.error('Request Reset Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการร้องขอเปลี่ยนรหัสผ่าน'
        });
    }
});

// 4. ตรจสอบ Token จากตาราง ResetPassword --> อัตเดตรหัสผ่านใหม่ลงตาราง User
router.post('/reset-password', async (req, res) => {
    const {Student_ID, resetToken, NewPassword} = req.body;

    if (!Student_ID || !resetToken || !NewPassword) {
        return res.status(400).json({
            success: false,
            message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
        });
    }

    try {
        // 1. ดึงข้อมูล User_ID
        const [users] = await db.query('SELECT * FROM User WHERE Student_ID = ?', [Student_ID]);
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบรหัสนักศึกษานี้ในระบบ'
            });
        }
        const userID = users[0].User_ID;

        // 2. ตรวจสอบ Request_code จากตาราง ResetPassword 
        const checkTokenQuery = `SELECT * FROM ResetPassword WHERE User_ID = ? AND Request_code = ? AND Is_used = FALSE AND Datetime_at > NOW()`;
        const [tokens] = await db.query(checkTokenQuery, [userID, resetToken]);

        if (tokens.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'รหัสยืนยันไม่ถูกต้อง หมดอายุ หรือถูกใช้งานไปแล้ว'
            });
        }
        
        // 3. เข้ารหัส Passwordใหม่ด้วย bcrypt
        const hashedPassword = await bcrypt.hash(NewPassword, 10);

        // 4. อัปเดตรหัสผ่านใหม่ลงในตาราง User
        await db.query('UPDATE User SET Password = ? WHERE User_ID = ?', [hashedPassword, userID]);

        // 5. ทำเครื่องหมายในตาราง ResetPassword ว่า Token นี้ใช้งานแล้ว (Is_Used = TRUE)
        await db.query('UPDATE ResetPassword SET Is_Used = TRUE WHERE Resetpassword_ID = ? ', [tokens[0].ResetPassword_ID]);

        res.json({
            success: true,
            message: 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่'
        });
    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการบันทึกรหัสผ่านใหม่'
        });
    }
});

// 5. API เข้าสู่ระบบของผู้ดูแลระบบ (POST /api/auth/admin-login)
router.post('/admin-login', async (req, res) => {
    const { Admin_email, Admin_password } = req.body;

    if (!Admin_email || !Admin_password) {
        return res.status(400).json({
            success: false,
            message: 'กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน'
        });
    }

    try {
        // 1. ตรวจสอบว่ามี Admin_email ในฐานข้อมูล(Admin) หรือไม่
        const getAdminQuery = 'SELECT * FROM Admin WHERE Admin_email = ?';
        const [admins] = await db.query(getAdminQuery, [Admin_email]);
        
        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
            });
        }

        const admin = admins[0];

        // 2. ตรวจสอบรหัสผ่านของผู้ดูแลระบบ (Admin) โดยเปรียบเทียบรหัสผ่านที่ได้รับจากผู้ดูแลระบบกับรหัสผ่านที่เก็บในฐานข้อมูล
        const isPasswordValid = await bcrypt.compare(Admin_password, admin.Admin_password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
            });
        }
        
        // 3. ลบ Admin_password ออกจากข้อมูลผู้ดูแลระบบก่อนส่งกลับ
        const { Admin_password: _, ...adminWithoutPassword } = admin;

        res.json({
            success: true,
            message: 'เข้าสู่ระบบสำเร็จ',
            role: 'admin',
            admin: adminWithoutPassword
        });
    } catch (error) {
        console.error('Admin Login Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบของผู้ดูแลระบบ'
        });
    }
});

module.exports = router;