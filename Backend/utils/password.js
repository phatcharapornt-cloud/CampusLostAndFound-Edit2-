// การเก็บและตรวจรหัสผ่าน (ใช้ร่วมกันทั้งผู้ใช้งานและ Admin)
//
// โปรเจกต์นี้ใช้สาธิต ไม่ได้เปิดใช้งานจริง จึงเก็บรหัสผ่านเป็นข้อความตามที่กรอก (ไม่ hash)
// เช่น สมัครด้วย Test*1234 → คอลัมน์ Password ในฐานข้อมูลเก็บ Test*1234
// ⚠️ ถ้าจะนำไปใช้งานจริง ควรกลับไปเข้ารหัสด้วย bcrypt (แก้แค่ toStoredPassword และ verifyPassword ในไฟล์นี้)
//
// รหัสผ่านเก่าที่เคยเข้ารหัสด้วย bcrypt ไว้ (ขึ้นต้นด้วย $2a$ / $2b$ / $2y$) ยังเข้าสู่ระบบได้ตามปกติ
// และระบบจะเปลี่ยนเป็นข้อความธรรมดาให้อัตโนมัติเมื่อเข้าสู่ระบบสำเร็จครั้งถัดไป
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function isBcryptHash(value) {
    return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value || ''));
}

// เทียบข้อความแบบใช้เวลาเท่ากันเสมอ (ไม่ให้เดารหัสผ่านจากเวลาที่ใช้ตอบกลับได้)
function safeEqual(a, b) {
    const hashA = crypto.createHash('sha256').update(String(a)).digest();
    const hashB = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

// ค่าที่บันทึกลงฐานข้อมูล = รหัสผ่านตามที่กรอก
function toStoredPassword(password) {
    return String(password);
}

// ตรวจรหัสผ่านที่กรอกกับค่าที่เก็บไว้
// คืน { ok, legacyHash } — legacyHash = true แปลว่าค่าที่เก็บไว้ยังเป็น bcrypt แบบเก่า (ควรบันทึกใหม่เป็นข้อความธรรมดา)
async function verifyPassword(input, stored) {
    if (isBcryptHash(stored)) {
        return { ok: await bcrypt.compare(String(input), stored), legacyHash: true };
    }
    return { ok: stored != null && safeEqual(input, stored), legacyHash: false };
}

module.exports = { isBcryptHash, safeEqual, toStoredPassword, verifyPassword };