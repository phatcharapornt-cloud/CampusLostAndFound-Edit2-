// สร้างบัญชี Admin ใหม่ หรือเปลี่ยนรหัสผ่านของ Admin ที่มีอยู่แล้ว (รหัสผ่านถูกเข้ารหัสด้วย bcrypt ก่อนบันทึก)
// วิธีใช้ (รันในโฟลเดอร์ Backend):
//   npm run create-admin -- admin@kmitl.ac.th 'Admin#2026'
// รหัสผ่านต้องผ่านเงื่อนไขเดียวกับผู้ใช้งาน: 8-16 ตัว มีตัวใหญ่ ตัวเล็ก ตัวเลข และอักขระพิเศษ
// (ใส่รหัสผ่านในเครื่องหมาย ' ' เพื่อไม่ให้ terminal ตีความอักขระพิเศษ เช่น # ! $)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { validateAdminEmail, validatePassword } = require('../utils/validators');

let db = null; // เชื่อมฐานข้อมูลหลังตรวจข้อมูลผ่านแล้วเท่านั้น

async function main() {
    const email = String(process.argv[2] || '').trim().toLowerCase();
    const password = String(process.argv[3] || '');

    if (!email || !password) {
        console.log("วิธีใช้: npm run create-admin -- <อีเมล> '<รหัสผ่าน>'");
        process.exitCode = 1;
        return;
    }

    const error = validateAdminEmail(email) || validatePassword(password);
    if (error) {
        console.error(`❌ ${error}`);
        process.exitCode = 1;
        return;
    }

    db = require('../config/db');
    const hashed = await bcrypt.hash(password, 10);

    // ถ้ามีอีเมลนี้อยู่แล้ว (Admin_email เป็น UNIQUE) จะอัปเดตรหัสผ่านแทนการเพิ่มใหม่
    const [result] = await db.query(
        `INSERT INTO Admin (Admin_email, Admin_password) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE Admin_password = VALUES(Admin_password)`,
        [email, hashed]
    );

    console.log(result.affectedRows === 1
        ? `✅ สร้างบัญชี Admin ${email} เรียบร้อยแล้ว`
        : `✅ เปลี่ยนรหัสผ่านของ Admin ${email} เรียบร้อยแล้ว`);
}

main()
    .catch((err) => {
        console.error('❌ สร้างบัญชี Admin ไม่สำเร็จ:', err.message);
        process.exitCode = 1;
    })
    .finally(() => db && db.end());