// คำสั่ง SQL สำหรับดึงรายการจับคู่สิ่งของ พร้อมข้อมูลสิ่งของที่หายและสิ่งของที่พบ
// ใช้ร่วมกันระหว่างหน้า "รายการจับคู่สิ่งของ" (routes/matchitem.js) และ History (routes/adminhistory.js)
const { computeMatchScore } = require('./matchingService');

// สถานะที่ใช้แสดง: Match_status = NULL หมายถึงยังรอ Admin ตรวจสอบ
const PENDING_LABEL = 'รอการตรวจสอบ';
const MATCH_STATUSES = [
    PENDING_LABEL,
    'ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน',
    'ปฏิเสธการส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน',
    'ผู้ใช้งานยืนยันการขอรับสิ่งของคืน',
    'ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน',
    'ผู้ใช้ยกเลิกรายการสิ่งของที่หาย',
];
const STATUS_SQL = `COALESCE(m.Match_status, '${PENDING_LABEL}')`;

const MATCH_FROM = `
    FROM MatchItem m
    JOIN LostItem l   ON m.Lost_ID = l.Lost_ID
    JOIN FoundItem f  ON m.Found_ID = f.Found_ID
    LEFT JOIN User lu     ON l.User_ID = lu.User_ID
    LEFT JOIN User fu     ON f.User_ID = fu.User_ID
    LEFT JOIN Category lc ON l.Category_ID = lc.Category_ID
    LEFT JOIN Location ll ON l.Location_ID = ll.Location_ID
    LEFT JOIN Category fc ON f.Category_ID = fc.Category_ID
    LEFT JOIN Location fl ON f.Location_ID = fl.Location_ID`;

const MATCH_COLUMNS = `
    m.Match_ID,
    m.Match_score,
    ${STATUS_SQL} AS Match_status,
    DATE_FORMAT(m.Match_date, '%Y-%m-%d') AS Match_date,
    TIME_FORMAT(m.Match_time, '%H:%i') AS Match_time,
    l.Lost_ID, lu.Student_ID AS Lost_Student_ID, l.LostItem_name, l.Lost_description, l.Lost_photo, l.Lost_status,
    DATE_FORMAT(l.Lost_date, '%Y-%m-%d') AS Lost_date, TIME_FORMAT(l.Lost_time, '%H:%i') AS Lost_time,
    l.Category_ID AS Lost_Category_ID, lc.Category_name AS Lost_Category_name,
    l.Location_ID AS Lost_Location_ID, ll.Location_name AS Lost_Location_name,
    f.Found_ID, fu.Student_ID AS Found_Student_ID, f.FoundItem_name, f.Found_description, f.Found_photo, f.Found_status,
    DATE_FORMAT(f.Found_date, '%Y-%m-%d') AS Found_date, TIME_FORMAT(f.Found_time, '%H:%i') AS Found_time,
    f.Category_ID AS Found_Category_ID, fc.Category_name AS Found_Category_name,
    f.Location_ID AS Found_Location_ID, fl.Location_name AS Found_Location_name`;

// แปลงแถวจากฐานข้อมูลเป็น { Match_ID, Match_score, Match_status, breakdown, lost: {...}, found: {...} }
function shapeMatchRow(row) {
    const lost = {
        Lost_ID: row.Lost_ID,
        Student_ID: row.Lost_Student_ID,
        LostItem_name: row.LostItem_name,
        Category_ID: row.Lost_Category_ID,
        Category_name: row.Lost_Category_name,
        Location_ID: row.Lost_Location_ID,
        Location_name: row.Lost_Location_name,
        Lost_description: row.Lost_description,
        Lost_photo: row.Lost_photo,
        Lost_date: row.Lost_date,
        Lost_time: row.Lost_time,
        Lost_status: row.Lost_status,
    };
    const found = {
        Found_ID: row.Found_ID,
        Student_ID: row.Found_Student_ID,
        FoundItem_name: row.FoundItem_name,
        Category_ID: row.Found_Category_ID,
        Category_name: row.Found_Category_name,
        Location_ID: row.Found_Location_ID,
        Location_name: row.Found_Location_name,
        Found_description: row.Found_description,
        Found_photo: row.Found_photo,
        Found_date: row.Found_date,
        Found_time: row.Found_time,
        Found_status: row.Found_status,
    };
    // คะแนนแยกแต่ละส่วน คำนวณใหม่จากข้อมูลปัจจุบันด้วยสูตรเดียวกับระบบจับคู่ (Match_score คือคะแนนที่บันทึกไว้ตอนจับคู่)
    const { parts, max } = computeMatchScore(lost, found);
    return {
        Match_ID: row.Match_ID,
        Match_score: Number(row.Match_score),
        Match_status: row.Match_status,
        Match_date: row.Match_date,
        Match_time: row.Match_time,
        breakdown: { parts, max },
        lost,
        found,
    };
}

module.exports = {
    PENDING_LABEL,
    MATCH_STATUSES,
    STATUS_SQL,
    MATCH_FROM,
    MATCH_COLUMNS,
    shapeMatchRow,
};