// Token สำหรับยืนยันตัวตนของ Admin หลังเข้าสู่ระบบ (ไม่ต้องติดตั้ง package เพิ่ม ใช้ crypto ของ Node)
// รูปแบบ token: <ข้อมูล base64url>.<ลายเซ็น HMAC-SHA256>  ข้อมูลข้างในคือ { Admin_ID, Admin_email, exp }
// ใครแก้ข้อมูลใน token เอง ลายเซ็นจะไม่ตรง เซิร์ฟเวอร์จะไม่ยอมรับ
//
// วิธีใช้กับ API ของ Admin:
//   const { requireAdmin } = require('../utils/admintoken');
//   router.get('/something', requireAdmin, (req, res) => { req.admin.Admin_ID ... });
// หน้าเว็บต้องส่ง header:  Authorization: Bearer <token>
const crypto = require('crypto');
const db = require('../config/db');

const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60; // token ใช้ได้ 8 ชั่วโมง แล้วต้องเข้าสู่ระบบใหม่

// กุญแจสำหรับเซ็น token: ตั้งค่า ADMIN_TOKEN_SECRET ในไฟล์ .env (ข้อความสุ่มยาว ๆ)
// ถ้าไม่ได้ตั้ง จะสุ่มใหม่ทุกครั้งที่เปิดเซิร์ฟเวอร์ → Admin ต้องเข้าสู่ระบบใหม่หลังรีสตาร์ท Backend
let secret = process.env.ADMIN_TOKEN_SECRET;
if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️  ยังไม่ได้ตั้ง ADMIN_TOKEN_SECRET ใน .env: Admin จะต้องเข้าสู่ระบบใหม่ทุกครั้งที่รีสตาร์ท Backend');
}

function sign(data) {
    return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

// สร้าง token ให้ Admin ที่เข้าสู่ระบบสำเร็จ
function createAdminToken(admin) {
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
    const payload = Buffer.from(JSON.stringify({
        Admin_ID: admin.Admin_ID,
        Admin_email: admin.Admin_email,
        exp: expiresAt,
    })).toString('base64url');
    return { token: `${payload}.${sign(payload)}`, expiresAt };
}

// ตรวจ token: คืนค่าข้อมูล Admin ถ้าถูกต้องและยังไม่หมดอายุ, คืน null ถ้าไม่ผ่าน
function verifyAdminToken(token) {
    if (typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!data.Admin_ID || !data.exp || data.exp <= Math.floor(Date.now() / 1000)) return null;
        return data;
    } catch {
        return null;
    }
}

// Middleware: ใส่หน้า route ที่ต้องเป็น Admin เท่านั้น ถ้าผ่านจะได้ req.admin = { Admin_ID, Admin_email, exp }
// ตรวจด้วยว่าบัญชี Admin ยังอยู่ในตาราง Admin (ถ้าถูกลบระหว่างที่ยังเข้าสู่ระบบอยู่ → ต้องเข้าสู่ระบบใหม่)
async function requireAdmin(req, res, next) {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const admin = verifyAdminToken(token);
    const unauthorized = (message) => res.status(401).json({
        success: false,
        code: 'ADMIN_UNAUTHORIZED',
        message
    });

    if (!admin) return unauthorized('กรุณาเข้าสู่ระบบผู้ดูแลระบบใหม่อีกครั้ง');

    try {
        const [[exists]] = await db.query('SELECT Admin_ID FROM Admin WHERE Admin_ID = ?', [admin.Admin_ID]);
        if (!exists) return unauthorized('ไม่พบบัญชีผู้ดูแลระบบนี้แล้ว กรุณาเข้าสู่ระบบใหม่');
    } catch (error) {
        console.error('Admin check error:', error);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์ผู้ดูแลระบบ' });
    }

    req.admin = admin;
    next();
}

module.exports = {
    TOKEN_LIFETIME_SECONDS,
    createAdminToken,
    verifyAdminToken,
    requireAdmin,
};