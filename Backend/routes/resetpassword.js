// API เปลี่ยนรหัสผ่าน (ลืมรหัสผ่าน)
// เปิดใช้ใน server.js ที่ path /api/auth เหมือน routes/auth.js จึงยังเรียกด้วย URL เดิม:
//   (1) POST /api/auth/request-reset   ขอรหัส OTP          (หน้า resetpass.html, ปุ่มส่งรหัสใหม่ใน Verify.html)
//   (2) POST /api/auth/verify-otp      ยืนยันรหัส OTP       (หน้า Verify.html)
//   (3) POST /api/auth/reset-password  ตั้งรหัสผ่านใหม่     (หน้า newpass.html)
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const {
    validateResetRequest,
    validateOtpVerification,
    validatePasswordReset,
} = require('../utils/validators');
// เก็บรหัสผ่านเป็นข้อความตามที่กรอก (ไม่ hash) ดูรายละเอียดใน utils/password.js
const { toStoredPassword, verifyPassword } = require('../utils/password');

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

// 1. ขอรหัส OTP (POST /api/auth/request-reset)
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

// 2. ยืนยันรหัส OTP (POST /api/auth/verify-otp)
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

// 3. ตั้งรหัสผ่านใหม่ (POST /api/auth/reset-password)
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
        if ((await verifyPassword(values.NewPassword, user.Password)).ok) {
            return badRequest(res, { NewPassword: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' });
        }

        // 4. รหัสผ่านใหม่ (เก็บตามที่กรอก ไม่ hash)
        const newPassword = toStoredPassword(values.NewPassword);

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

        await connection.query('UPDATE User SET Password = ? WHERE User_ID = ?', [newPassword, user.User_ID]);
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

module.exports = router;