const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const {
    validateRegistration,
    validateLogin,
    validateResetRequest,
    validateOtpVerification,
    validatePasswordReset,
} = require('../utils/validators');

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
// ผู้ใช้งาน (App-user): Body { Student_ID, Password }
//   200 = สำเร็จ (role: 'user', user: ข้อมูลผู้ใช้ไม่รวมรหัสผ่าน) | 400 = กรอกไม่ครบ/รูปแบบผิด | 401 = รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง
// แบบเดิม: Body { Email, Password } ยังใช้ได้ (ผู้ใช้งานหรือ Admin เข้าด้วยอีเมล)
router.post('/login', async (req, res) => {
    const body = req.body ?? {};

    if (body.Email === undefined) {
        return loginWithStudentId(body, res);
    }

    const { Email, Password } = body;

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

        // 3. เปรียบเทียบรหัสผ่านที่กรอกกับรหัสผ่านที่เข้ารหัส (bcrypt) ไว้ในฐานข้อมูล
        const user = users[0];
        const isPasswordValid = await bcrypt.compare(values.Password, user.Password);

        if (!isPasswordValid) {
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

// ---------- 3. เปลี่ยนรหัสผ่าน (ลืมรหัสผ่าน) ----------
// ขั้นตอน: (3.1) request-reset ขอรหัส OTP → (3.2) verify-otp ยืนยัน OTP → (3.3) reset-password ตั้งรหัสผ่านใหม่
// ทุกขั้นตอบกลับเป็น JSON { success, message, code?, errors? }
//   code: OTP_EXPIRED = OTP หมดอายุ/ถูกใช้แล้ว | OTP_INVALID = OTP ผิด | OTP_LOCKED = กรอกผิดเกินกำหนด | OTP_COOLDOWN = ขอ OTP ถี่เกินไป

const OTP_EXPIRE_SECONDS = 10 * 60;  // OTP ใช้ได้ 10 นาที
const OTP_RESEND_SECONDS = 60;       // ขอ OTP ใหม่ได้ทุก 60 วินาที
const OTP_MAX_ATTEMPTS = 5;          // กรอก OTP ผิดได้ไม่เกิน 5 ครั้งต่อ 1 รหัส

// โหมดสาธิต: ส่ง OTP กลับไปให้แอปแสดงเป็น Notification (เพราะยังไม่มีระบบส่งอีเมลจริง)
// เมื่อเชื่อมระบบส่งอีเมลแล้ว ให้เพิ่ม SHOW_OTP_ON_SCREEN=false ในไฟล์ .env เพื่อไม่ส่ง OTP กลับไปกับ API
const SHOW_OTP_ON_SCREEN = process.env.SHOW_OTP_ON_SCREEN !== 'false';

// นับจำนวนครั้งที่กรอก OTP ผิด แยกตาม ResetPassword_ID (เก็บในหน่วยความจำ รีเซ็ตเมื่อรีสตาร์ทเซิร์ฟเวอร์)
const failedOtpAttempts = new Map();

function otpError(code, message, extra = {}) {
    return { success: false, code, message, errors: { OTP: message }, ...extra };
}

async function findUserByStudentId(studentId) {
    const [users] = await db.query('SELECT User_ID, Email, Password FROM User WHERE Student_ID = ?', [studentId]);
    return users[0] || null;
}

// หา OTP ล่าสุดของผู้ใช้ที่ยังใช้ได้ (ยังไม่ถูกใช้ และยังไม่หมดอายุ)
// ใช้เวลาของ MySQL (NOW()) ทั้งตอนบันทึกและตอนตรวจ เพื่อไม่ให้เวลาเพี้ยนระหว่าง Node กับฐานข้อมูล
async function findActiveOtp(userId) {
    const [rows] = await db.query(
        `SELECT ResetPassword_ID, Request_code, TIMESTAMPDIFF(SECOND, NOW(), Datetime_at) AS secondsLeft
         FROM ResetPassword
         WHERE User_ID = ? AND Is_used = FALSE AND Datetime_at > NOW()
         ORDER BY Datetime_at DESC
         LIMIT 1`,
        [userId]
    );
    return rows[0] || null;
}

// ตรวจรหัส OTP คืนค่า { ok: true, reset } หรือ { ok: false, status, body }
async function checkOtp(userId, otp) {
    const reset = await findActiveOtp(userId);
    if (!reset) {
        return { ok: false, status: 400, body: otpError('OTP_EXPIRED', 'รหัส OTP หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอรหัสใหม่') };
    }

    if (reset.Request_code !== otp) {
        const attempts = (failedOtpAttempts.get(reset.ResetPassword_ID) || 0) + 1;

        // กรอกผิดครบกำหนด: ยกเลิก OTP นี้ทันที ต้องขอรหัสใหม่
        if (attempts >= OTP_MAX_ATTEMPTS) {
            failedOtpAttempts.delete(reset.ResetPassword_ID);
            await db.query('UPDATE ResetPassword SET Is_used = TRUE WHERE ResetPassword_ID = ?', [reset.ResetPassword_ID]);
            return { ok: false, status: 400, body: otpError('OTP_LOCKED', `กรอกรหัส OTP ผิดเกิน ${OTP_MAX_ATTEMPTS} ครั้ง รหัสนี้ถูกยกเลิกแล้ว กรุณาขอรหัสใหม่`) };
        }

        failedOtpAttempts.set(reset.ResetPassword_ID, attempts);
        const attemptsLeft = OTP_MAX_ATTEMPTS - attempts;
        return { ok: false, status: 400, body: otpError('OTP_INVALID', `รหัส OTP ไม่ถูกต้อง (กรอกได้อีก ${attemptsLeft} ครั้ง)`, { attemptsLeft }) };
    }

    return { ok: true, reset };
}

function badRequest(res, errors) {
    return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
}

function studentNotFound(res) {
    const message = 'ไม่พบรหัสนักศึกษานี้ในระบบ';
    return res.status(404).json({ success: false, message, errors: { Student_ID: message } });
}

// 3.1 ขอรหัส OTP (POST /api/auth/request-reset)
// Body: { Student_ID }
// 200 = { email, expiresInSeconds, resendAfterSeconds, otp (โหมดสาธิต) } | 400 รูปแบบผิด | 404 ไม่พบรหัสนักศึกษา | 429 ขอถี่เกินไป
router.post('/request-reset', async (req, res) => {
    const { values, errors } = validateResetRequest(req.body ?? {});
    if (Object.keys(errors).length > 0) return badRequest(res, errors);

    try {
        // 1. ตรวจสอบว่ามีรหัสนักศึกษานี้ในตาราง User หรือไม่
        const user = await findUserByStudentId(values.Student_ID);
        if (!user) return studentNotFound(res);

        // 2. กันการขอ OTP ถี่เกินไป (ต้องรอ 60 วินาทีนับจากครั้งล่าสุด)
        const active = await findActiveOtp(user.User_ID);
        if (active) {
            const secondsSinceIssued = OTP_EXPIRE_SECONDS - active.secondsLeft;
            const waitSeconds = OTP_RESEND_SECONDS - secondsSinceIssued;
            if (waitSeconds > 0) {
                return res.status(429).json({
                    success: false,
                    code: 'OTP_COOLDOWN',
                    message: `กรุณารอ ${waitSeconds} วินาที ก่อนขอรหัส OTP ใหม่`,
                    retryAfterSeconds: waitSeconds
                });
            }
        }

        // 3. ยกเลิก OTP เดิมที่ยังไม่ได้ใช้ ให้เหลือรหัสที่ใช้ได้แค่รหัสล่าสุด
        await db.query('UPDATE ResetPassword SET Is_used = TRUE WHERE User_ID = ? AND Is_used = FALSE', [user.User_ID]);

        // 4. สร้าง OTP 6 หลักแบบสุ่ม (crypto) และ ResetPassword_ID ไม่เกิน 20 ตัวอักษร เช่น RP1792141234567123
        const otp = String(crypto.randomInt(100000, 1000000));
        const resetPasswordId = `RP${Date.now()}${crypto.randomInt(100, 1000)}`;

        // 5. บันทึกลงตาราง ResetPassword (Datetime_at = เวลาหมดอายุ = ตอนนี้ + 10 นาที)
        await db.query(
            `INSERT INTO ResetPassword (ResetPassword_ID, User_ID, Request_code, Datetime_at, Is_used)
             VALUES (?, ?, ?, NOW() + INTERVAL ? SECOND, FALSE)`,
            [resetPasswordId, user.User_ID, otp, OTP_EXPIRE_SECONDS]
        );

        const response = {
            success: true,
            message: 'ส่งรหัส OTP เรียบร้อยแล้ว',
            email: user.Email,
            expiresInSeconds: OTP_EXPIRE_SECONDS,
            resendAfterSeconds: OTP_RESEND_SECONDS
        };
        if (SHOW_OTP_ON_SCREEN) response.otp = otp; // ให้หน้า Verify แสดงเป็น Notification

        res.status(200).json(response);
    } catch (error) {
        console.error('Request Reset Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการร้องขอเปลี่ยนรหัสผ่าน'
        });
    }
});

// 3.2 ยืนยันรหัส OTP (POST /api/auth/verify-otp)
// Body: { Student_ID, OTP }
// 200 = OTP ถูกต้อง (ยังไม่ถูกใช้ จะใช้จริงตอนตั้งรหัสผ่านใหม่) | 400 OTP ผิด/หมดอายุ | 404 ไม่พบรหัสนักศึกษา
router.post('/verify-otp', async (req, res) => {
    const { values, errors } = validateOtpVerification(req.body ?? {});
    if (Object.keys(errors).length > 0) return badRequest(res, errors);

    try {
        const user = await findUserByStudentId(values.Student_ID);
        if (!user) return studentNotFound(res);

        const result = await checkOtp(user.User_ID, values.OTP);
        if (!result.ok) return res.status(result.status).json(result.body);

        res.status(200).json({
            success: true,
            message: 'ยืนยันรหัส OTP สำเร็จ',
            expiresInSeconds: result.reset.secondsLeft // เวลาที่เหลือสำหรับตั้งรหัสผ่านใหม่
        });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการยืนยันรหัส OTP'
        });
    }
});

// 3.3 ตั้งรหัสผ่านใหม่ (POST /api/auth/reset-password)
// Body: { Student_ID, OTP, NewPassword }
// 200 = บันทึกรหัสผ่านใหม่ลงตาราง User แล้ว | 400 OTP ผิด/หมดอายุ หรือรหัสผ่านไม่ผ่านเงื่อนไข/ซ้ำรหัสเดิม | 404 ไม่พบรหัสนักศึกษา
router.post('/reset-password', async (req, res) => {
    const { values, errors } = validatePasswordReset(req.body ?? {});
    if (Object.keys(errors).length > 0) return badRequest(res, errors);

    let connection;
    try {
        // 1. ค้นหาผู้ใช้จากรหัสนักศึกษา
        const user = await findUserByStudentId(values.Student_ID);
        if (!user) return studentNotFound(res);

        // 2. ตรวจรหัส OTP อีกครั้ง (กันการเรียก API นี้ตรง ๆ โดยไม่ผ่านหน้า Verify)
        const result = await checkOtp(user.User_ID, values.OTP);
        if (!result.ok) return res.status(result.status).json(result.body);

        // 3. รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม
        if (await bcrypt.compare(values.NewPassword, user.Password)) {
            return badRequest(res, { NewPassword: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' });
        }

        // 4. เข้ารหัสรหัสผ่านใหม่ด้วย bcrypt
        const hashedPassword = await bcrypt.hash(values.NewPassword, 10);

        // 5. บันทึกด้วย Transaction: ทำเครื่องหมายว่าใช้ OTP แล้ว + อัปเดตรหัสผ่านในตาราง User (สำเร็จพร้อมกันหรือไม่ทำเลย)
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [marked] = await connection.query(
            'UPDATE ResetPassword SET Is_used = TRUE WHERE ResetPassword_ID = ? AND Is_used = FALSE',
            [result.reset.ResetPassword_ID]
        );
        if (marked.affectedRows === 0) {
            // OTP ถูกใช้ไปแล้วระหว่างนี้ (เช่น กดยืนยันซ้ำสองครั้งพร้อมกัน)
            await connection.rollback();
            return res.status(400).json(otpError('OTP_EXPIRED', 'รหัส OTP หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอรหัสใหม่'));
        }

        await connection.query('UPDATE User SET Password = ? WHERE User_ID = ?', [hashedPassword, user.User_ID]);
        await connection.commit();
        failedOtpAttempts.delete(result.reset.ResetPassword_ID);

        res.status(200).json({
            success: true,
            message: 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่'
        });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        console.error('Reset Password Error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการบันทึกรหัสผ่านใหม่'
        });
    } finally {
        if (connection) connection.release();
    }
});

// 4. API เข้าสู่ระบบของผู้ดูแลระบบ (POST /api/auth/admin-login)
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