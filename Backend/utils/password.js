// การเก็บและตรวจรหัสผ่าน (ใช้ร่วมกันทั้งผู้ใช้งานและ Admin)
//
// โปรเจกต์นี้ใช้สาธิต ไม่ได้เปิดใช้งานจริง จึงเก็บรหัสผ่านเป็นข้อความตามที่กรอก (ไม่ hash)
// เช่น สมัครด้วย Test*1234 → คอลัมน์ Password ในฐานข้อมูลเก็บ Test*1234
// ⚠️ ถ้าจะนำไปใช้งานจริง ควรกลับไปเข้ารหัสด้วย bcrypt (แก้แค่ toStoredPassword และ verifyPassword ในไฟล์นี้)
const crypto = require('crypto');

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

// รหัสผ่านที่กรอกตรงกับค่าที่เก็บไว้หรือไม่ (true / false)
function verifyPassword(input, stored) {
    return stored != null && safeEqual(input, stored);
}

module.exports = { safeEqual, toStoredPassword, verifyPassword };