// การเปลี่ยนสถานะของสิ่งของที่พบ (FoundItem) + การแจ้งเตือนที่ต้องส่งทุกครั้งที่สถานะเปลี่ยน
//
//   'รอการอนุมัติ' → 'อนุมัติแล้ว'  : Admin กดอนุมัติ (routes/adminapprovefound.js)
//   'รอการอนุมัติ' → 'ถูกปฏิเสธ'    : Admin กดปฏิเสธ หรือผู้ใช้ไม่นำสิ่งของมาส่งภายใน 30 นาที (ฟังก์ชัน expireOverdueFoundItems ด้านล่าง)
//
// การปฏิเสธอัตโนมัติ 30 นาที: เดิมใช้ Event ของ MySQL (schema.sql ข้อ 11) ซึ่ง "ลบ" รายการทิ้ง
// และลบการแจ้งเตือนของรายการนั้นไปด้วย จึงย้ายมาทำใน Backend แทน: ตรวจทุก 1 นาที เปลี่ยนสถานะเป็น 'ถูกปฏิเสธ'
// และแจ้งเตือนผู้ใช้งาน (เริ่มทำงานใน server.js ด้วย startFoundExpiryJob())
const db = require('../config/db');

const FOUND_EXPIRE_MINUTES = 30;      // ต้องนำสิ่งของมาส่งมอบที่ส่วนกลางภายในกี่นาที
const EXPIRY_CHECK_INTERVAL_MS = 60 * 1000;

// ข้อความแจ้งเตือน (Notification.Message ยาวได้ 200 ตัวอักษร: ชื่อสิ่งของยาวสุด 100 ตัวอักษร จึงไม่เกิน)
const MESSAGES = {
    reported:     (name) => `ท่านได้ทำการแจ้งสิ่งของที่พบสำเร็จ "${name}" กรุณานำสิ่งของมาส่งมอบที่ส่วนกลางภายใน ${FOUND_EXPIRE_MINUTES} นาที`,
    adminNew:     (name) => `มีรายการแจ้งสิ่งของที่พบเข้ามาใหม่ "${name}"`,
    approved:     (name) => `เจ้าหน้าที่อนุมัติรายการสิ่งของที่พบ "${name}" แล้ว (สถานะ: อนุมัติแล้ว)`,
    rejected:     (name) => `เจ้าหน้าที่ปฏิเสธรายการสิ่งของที่พบ "${name}" (สถานะ: ถูกปฏิเสธ)`,
    expired:      (name) => `รายการสิ่งของที่พบ "${name}" ถูกปฏิเสธอัตโนมัติ เนื่องจากไม่ได้นำสิ่งของมาส่งมอบภายใน ${FOUND_EXPIRE_MINUTES} นาที`,
};

// การแจ้งเตือน "มีรายการใหม่" ของ Admin สำหรับรายการนี้ ไม่ต้องค้างไว้แล้วเมื่อรายการถูกจัดการ → ทำเครื่องหมายว่าอ่านแล้ว
async function markAdminNotificationsRead(conn, foundIds) {
    if (!foundIds.length) return;
    await conn.query(
        'UPDATE Notification SET Is_read = TRUE WHERE Admin_ID IS NOT NULL AND Found_ID IN (?) AND Is_read = FALSE',
        [foundIds]
    );
}

// เปลี่ยนรายการที่ 'รอการอนุมัติ' เกิน 30 นาที (นับจาก Foundcheck_at = เวลาที่แจ้ง) เป็น 'ถูกปฏิเสธ' + แจ้งเตือนผู้ใช้
// คืนค่า Found_ID ที่ถูกเปลี่ยน
let running = null;
async function expireOverdueFoundItems() {
    if (running) return running;   // กันการทำงานซ้อนกัน (เช่น ตัวจับเวลา + มีคนเปิดหน้า Admin พร้อมกัน)
    running = (async () => {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [items] = await conn.query(
                `SELECT Found_ID, User_ID, FoundItem_name FROM FoundItem
                 WHERE Found_status = 'รอการอนุมัติ' AND Foundcheck_at <= NOW() - INTERVAL ? MINUTE
                 FOR UPDATE`,
                [FOUND_EXPIRE_MINUTES]
            );
            if (items.length === 0) {
                await conn.commit();
                return [];
            }
            const ids = items.map((item) => item.Found_ID);
            await conn.query(
                "UPDATE FoundItem SET Found_status = 'ถูกปฏิเสธ', Admin_ID = NULL WHERE Found_ID IN (?) AND Found_status = 'รอการอนุมัติ'",
                [ids]
            );
            await conn.query(
                'INSERT INTO Notification (User_ID, Found_ID, Message) VALUES ?',
                [items.map((item) => [item.User_ID, item.Found_ID, MESSAGES.expired(item.FoundItem_name)])]
            );
            await markAdminNotificationsRead(conn, ids);
            await conn.commit();
            console.log(`[Found Expiry] ปฏิเสธอัตโนมัติ (เกิน ${FOUND_EXPIRE_MINUTES} นาที): Found_ID ${ids.join(', ')}`);
            return ids;
        } catch (error) {
            await conn.rollback().catch(() => {});
            throw error;
        } finally {
            conn.release();
        }
    })();
    try {
        return await running;
    } finally {
        running = null;
    }
}

// เริ่มตัวตรวจอัตโนมัติ (เรียกครั้งเดียวตอนเปิดเซิร์ฟเวอร์)
function startFoundExpiryJob() {
    const run = () => expireOverdueFoundItems().catch((error) => console.error('Found Expiry Error:', error.message));
    run();
    return setInterval(run, EXPIRY_CHECK_INTERVAL_MS);
}

module.exports = {
    FOUND_EXPIRE_MINUTES,
    MESSAGES,
    markAdminNotificationsRead,
    expireOverdueFoundItems,
    startFoundExpiryJob,
};