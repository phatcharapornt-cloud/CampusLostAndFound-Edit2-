// แจ้งเตือน Admin ทุกคน: บันทึกลงตาราง Notification คนละ 1 แถว (แต่ละคนมีสถานะอ่าน/ยังไม่อ่านของตัวเอง)
//   await notifyAllAdmins(conn, { Found_ID: 12 }, 'มีรายการแจ้งสิ่งของที่พบเข้ามาใหม่ "..."')
//   links: { Lost_ID, Found_ID, Match_ID, Claim_ID } ใส่เฉพาะที่เกี่ยวข้อง (ที่ไม่ใส่ = NULL)
//
// ดึงรายชื่อ Admin ออกมาก่อน แล้ว INSERT ทีเดียวแบบ VALUES (...), (...) ที่รู้จำนวนแถวแน่นอน
// (ถ้าใช้ INSERT ... SELECT FROM Admin, MySQL จะจองเลข Notification_ID เผื่อไว้ แล้วเลขที่ไม่ได้ใช้จะถูกข้าม เช่น 3, 4, 6)
// conn: connection ที่อยู่ใน transaction (หรือ db pool ก็ได้) คืนค่าจำนวน Admin ที่แจ้งเตือน
async function notifyAllAdmins(conn, links, message) {
    const [admins] = await conn.query('SELECT Admin_ID FROM Admin ORDER BY Admin_ID');
    if (admins.length === 0) return 0;

    const rows = admins.map((admin) => [
        admin.Admin_ID,
        links.Lost_ID ?? null,
        links.Found_ID ?? null,
        links.Match_ID ?? null,
        links.Claim_ID ?? null,
        message,
    ]);
    await conn.query(
        'INSERT INTO Notification (Admin_ID, Lost_ID, Found_ID, Match_ID, Claim_ID, Message) VALUES ?',
        [rows]
    );
    return rows.length;
}

module.exports = { notifyAllAdmins };