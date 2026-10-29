# Campus Lost & Found

ระบบแจ้งสิ่งของหายและสิ่งของที่พบภายในคณะวิทยาศาสตร

App-user : หน้าเว็บสำหรับนักศึกษา (หน้าจอแบบมือถือ) เริ่มที่ `login.html`
Web-Admin : หน้าเว็บสำหรับเจ้าหน้าที่ เริ่มที่ `login.html` 
Backend : API ด้วย Node.js + Express เชื่อม MySQL ผ่าน mysql2 (พอร์ต 5001)
Database : schema.sql สร้าง 10 ตาราง, seed.sql ข้อมูลหมวดหมู่ 24 รายการและสถานที่ 11 แห่ง

สิ่งที่ต้องมีในเครื่อง
1. Node.js 18 ขึ้นไป
2. MySQL 8.0.13 ขึ้นไป (schema ใช้ค่าเริ่มต้นแบบ `DEFAULT (CURRENT_DATE)`)
3. VS Code พร้อมส่วนขยาย Live Server หรือเว็บเซิร์ฟเวอร์อื่นสำหรับเปิดไฟล์ HTML

วิธีติดตั้งและรัน

1. ดาวน์โหลดโค้ด

```bash
git clone https://github.com/phatcharapornt-cloud/CampusLostAndFound-Edit2-.git
cd CampusLostAndFound-Edit2-
```

2. สร้างฐานข้อมูล 

ทุกคำสั่งต้องมี `--default-character-set=utf8mb4` ไม่อย่างนั้นข้อความภาษาไทยจะเพี้ยน

2.1 สร้างฐานข้อมูลเปล่า (มีแค่หมวดหมู่และสถานที่) (bash ลงใน Terminal)

bash
mysql -u root -p --default-character-set=utf8mb4 < Database/schema.sql
mysql -u root -p --default-character-set=utf8mb4 < Database/seed.sql


ระบบไม่มีหน้าสมัครบัญชีเจ้าหน้าที่ ให้เพิ่มบัญชีด้วยคำสั่ง SQL:

sql
USE campus_lost_and_found;
INSERT INTO Admin (Admin_email, Admin_password) VALUES ('admin@kmitl.ac.th', 'Admin*1234');

3. เปิด Backend

bash
cd Backend
npm install
cp .env.example .env

3.1. แก้ไฟล์ `Backend/.env`:

- `DB_PASSWORD` = รหัสผ่าน MySQL ของเครื่อง
- `ADMIN_TOKEN_SECRET` = ข้อความสุ่มสำหรับลงชื่อ token ของเจ้าหน้าที่ สร้างได้ด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `PORT` ต้องเป็น `5001` เพราะหน้าเว็บเรียก API ที่ `http://localhost:5001`

bash
npm start


ถ้าขึ้น `Server running on http://localhost:5001` และ `Connected to MySQL Database successfully!` แปลว่าพร้อมใช้งาน

4. เปิดหน้าเว็บ

เปิดด้วย Live Server ใน VS Code (คลิกขวาที่ไฟล์ → Open with Live Server):

- ฝั่งนักศึกษา: `App-user/login.html`
- ฝั่งเจ้าหน้าที่: `Web-Admin/login.html`

5. ทดลองใช้งานตามขั้นตอนหลัก

ระบบจะไม่จับคู่สิ่งของที่ผู้แจ้งของหายและผู้แจ้งของที่พบเป็นคนเดียวกัน จึงต้องสมัครผู้ใช้ 2 คน รหัสนักศึกษาเป็นตัวเลข 8 หลัก อีเมลต้องเป็น `รหัสนักศึกษา@kmitl.ac.th` ส่วนรหัสผ่านยาว 8–16 ตัว มีพิมพ์ใหญ่ พิมพ์เล็ก ตัวเลข และอักขระพิเศษ

1. ผู้ใช้ A แจ้งสิ่งของที่หาย
2. ผู้ใช้ B แจ้งสิ่งของที่พบ โดยใช้หมวดหมู่และสถานที่เดียวกัน และชื่อคล้ายกัน
3. เจ้าหน้าที่อนุมัติสิ่งของที่พบภายใน 30 นาที ที่หน้า "อนุมัติสิ่งของที่พบ" (เกิน 30 นาทีระบบจะปฏิเสธให้อัตโนมัติ)
4. ระบบจับคู่ให้ทันทีถ้า Match Score มากกว่า 70 เจ้าหน้าที่อนุมัติคู่ที่หน้า "รายการจับคู่สิ่งของ"
5. ผู้ใช้ A เปิดอีเมลจำลองจากการแจ้งเตือน แล้วกด "ขอรับสิ่งของคืน" ภายใน 24 ชั่วโมง
6. เจ้าหน้าที่อนุมัติคำขอ แล้วกด "คืนสิ่งของแล้ว" ที่หน้า "คำขอรับสิ่งของคืน"

ระบบยังไม่ได้ส่งอีเมลจริง: รหัส OTP ของหน้าลืมรหัสผ่านแสดงเป็นการแจ้งเตือนบนหน้าจอ และอีเมลแจ้งผลการจับคู่อยู่ในหน้าอีเมลจำลองของแอป

6. โครงสร้าง Backend

ทุก route ส่งค่าเข้า SQL ผ่านเครื่องหมาย `?` (parameterized query) และงานที่แก้หลายตารางพร้อมกันทำใน transaction

6.1. Path --> ไฟล์ --> หน้าที่

  1. `/api/auth`: `routes/auth.js` --> สมัคร เข้าสู่ระบบ, `routes/resetpassword.js`-->  ลืมรหัสผ่าน (OTP), `routes/adminauth.js`--> เข้าสู่ระบบเจ้าหน้าที่
  2. `/api/items` : `routes/item.js` --> แจ้งของหาย/ของที่พบ ยกเลิกรายการ , `routes/itemsearch.js` --> ค้นหา, `routes/myitems.js` --> รายการของฉัน 
  3. `/api/match` : `routes/matchitem.js`-->เจ้าหน้าที่ตรวจและอนุมัติรายการจับคู่
  4. `/api/mail` : `routes/mockmail.js` --> อีเมลจำลองแจ้งผลการจับคู่
  5. `/api/claim` : `routes/claimitem.js` --> ขอรับสิ่งของคืน อนุมัติ ปฏิเสธ และบันทึกการคืน
  6. `/api/notifications`, `/api/profile` : `routes/notifications.js` --> การแจ้งเตือน, `routes/profile.js` --> โปรไฟล์ของผู้ใช้
  7. `/api/admin` : `routes/adminapprovefound.js` --> อนุมัติของที่พบ , `routes/admindashboard.js` --> หน้าหลัก, `routes/adminhistory.js` -->  History, `routes/adminnotifications.js` --> การแจ้งเตือนของเจ้าหน้าที่

งานเบื้องหลังอยู่ใน `service/`:
  1. `matchingService.js`: คำนวณ Match Score (หมวดหมู่ 40, สถานที่ 30, ชื่อ 15, รายละเอียด 15) และปิดคู่ที่ผู้ใช้ไม่ตอบใน 24 ชั่วโมง ตรวจทุก 5 นาที
  2. `foundstatus.js`: ปฏิเสธสิ่งของที่พบที่ไม่ได้นำมาส่งภายใน 30 นาที ตรวจทุก 1 นาที

7. ฐานข้อมูล

ดูโครงสร้างเต็มได้ที่ `Database/schema.sql` 
  1. `User`, `Admin` --> บัญชีนักศึกษาและเจ้าหน้าที่ 
  2. `Category`, `Location` --> หมวดหมู่สิ่งของและสถานที่ 
  3. `ResetPassword` --> รหัส OTP สำหรับตั้งรหัสผ่านใหม่
  4. `LostItem`, `FoundItem` --> สิ่งของที่หายและสิ่งของที่พบ
  5. `MatchItem` --> คู่สิ่งของที่ระบบจับคู่ได้ (Match Score มากกว่า 70)
  6. `Claim` -->คำขอรับสิ่งของคืน (1 คู่มีได้ไม่เกิน 1 คำขอ) 
  7. `Notification` --> การแจ้งเตือนของผู้ใช้และเจ้าหน้าที่ 
