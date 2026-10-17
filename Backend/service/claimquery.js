// คำสั่ง SQL สำหรับดึงคำขอรับสิ่งของคืน (Claim) พร้อมข้อมูลสิ่งของที่หายและสิ่งของที่พบของคู่ที่ขอรับคืน
// ใช้ร่วมกันระหว่างหน้า "คำขอรับสิ่งของคืน" (routes/claimitem.js) และ History (routes/adminhistory.js)
const { MATCH_FROM, MATCH_COLUMNS, shapeMatchRow } = require('./matchquery');

// สถานะทั้งหมด (ตรงกับ ENUM ของคอลัมน์ Claim.Claim_status)
const CLAIM_STATUSES = ['รอการอนุมัติ', 'อนุมัติ', 'ปฏิเสธ', 'คืนสิ่งของแล้ว'];

// เริ่มจากตาราง Claim แล้วต่อด้วยข้อมูลคู่สิ่งของ (เหมือนหน้ารายการจับคู่) + ผู้ขอรับคืน + Admin ผู้ดำเนินการ
const CLAIM_FROM = MATCH_FROM.replace(
    'FROM MatchItem m',
    `FROM Claim c
    JOIN MatchItem m ON c.Match_ID = m.Match_ID`
) + `
    JOIN User cu       ON c.User_ID = cu.User_ID
    LEFT JOIN Admin ca ON c.Admin_ID = ca.Admin_ID`;

const CLAIM_COLUMNS = `
    c.Claim_ID,
    c.Claim_status,
    c.Claim_detail,
    DATE_FORMAT(c.Claim_date, '%Y-%m-%d') AS Claim_date,
    DATE_FORMAT(c.Claimcheck_at, '%Y-%m-%d %H:%i:%s') AS Claimcheck_at,
    cu.User_ID AS Claim_User_ID,
    cu.Student_ID AS Claim_Student_ID,
    cu.FName AS Claim_FName,
    cu.LName AS Claim_LName,
    ca.Admin_email AS Handled_by,
    ${MATCH_COLUMNS}`;

// แปลงแถวจากฐานข้อมูลเป็น { Claim_ID, Claim_status, Claim_date, Claimcheck_at, Handled_by, claimant: {...}, match: {...lost, found} }
function shapeClaimRow(row) {
    return {
        Claim_ID: row.Claim_ID,
        Claim_status: row.Claim_status,
        Claim_detail: row.Claim_detail,
        Claim_date: row.Claim_date,
        Claimcheck_at: row.Claimcheck_at,
        Handled_by: row.Handled_by || null,
        claimant: {
            User_ID: row.Claim_User_ID,
            Student_ID: row.Claim_Student_ID,
            FName: row.Claim_FName,
            LName: row.Claim_LName,
        },
        match: shapeMatchRow(row),
    };
}

module.exports = { CLAIM_STATUSES, CLAIM_FROM, CLAIM_COLUMNS, shapeClaimRow };