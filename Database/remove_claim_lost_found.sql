-- ปรับตาราง Claim ในฐานข้อมูลเดิม: ลบคอลัมน์ Lost_ID / Found_ID (ดึงผ่าน MatchItem แทน) + เพิ่ม UNIQUE ให้ Match_ID
-- ใช้เฉพาะฐานข้อมูลที่สร้างจาก schema.sql รุ่นก่อน (ตาราง Claim ยังมี Lost_ID / Found_ID อยู่) และรันครั้งเดียว
-- ฐานข้อมูลที่สร้างใหม่จาก schema.sql ล่าสุดไม่ต้องรันไฟล์นี้
USE campus_lost_and_found;

-- ขั้นที่ 1: ตรวจข้อมูลก่อน (ทั้ง 2 คำสั่งต้องได้ผลว่าง Empty set ถ้ามีแถวออกมา ให้หยุดและแก้ข้อมูลก่อน)
-- คำสั่งที่ 1: รายการจับคู่ที่มีคำขอรับคืนมากกว่า 1 รายการ (ถ้ามี จะเพิ่ม UNIQUE ไม่ได้)
SELECT Match_ID, COUNT(*) AS n FROM Claim GROUP BY Match_ID HAVING COUNT(*) > 1;
-- คำสั่งที่ 2: คำขอที่ Lost_ID / Found_ID ไม่ตรงกับรายการจับคู่ของตัวเอง
SELECT c.Claim_ID, c.Match_ID, c.Lost_ID, m.Lost_ID AS Match_Lost_ID, c.Found_ID, m.Found_ID AS Match_Found_ID
FROM Claim c
JOIN MatchItem m ON c.Match_ID = m.Match_ID
WHERE c.Lost_ID <> m.Lost_ID OR c.Found_ID <> m.Found_ID;

-- ขั้นที่ 2: ลบ Foreign Key ของ Lost_ID และ Found_ID ก่อน (ถ้ายังมี FK อยู่ จะลบคอลัมน์ไม่ได้)
-- ชื่อ FK ในแต่ละเครื่องไม่เหมือนกัน จึงหาชื่อจาก information_schema แล้วสร้างคำสั่ง ALTER TABLE ... DROP FOREIGN KEY ให้
SELECT GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', CONSTRAINT_NAME, '`') SEPARATOR ', ') INTO @drop_fk
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'Claim'
  AND COLUMN_NAME IN ('Lost_ID', 'Found_ID')
  AND REFERENCED_TABLE_NAME IS NOT NULL;
SET @sql = IF(@drop_fk IS NULL, 'SELECT ''ไม่พบ FK ของ Lost_ID / Found_ID'' AS info', CONCAT('ALTER TABLE Claim ', @drop_fk));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ขั้นที่ 3: ลบคอลัมน์ Lost_ID / Found_ID และเพิ่ม UNIQUE ให้ Match_ID (1 รายการจับคู่ มีคำขอรับคืนได้ไม่เกิน 1 รายการ)
ALTER TABLE Claim
    DROP COLUMN Lost_ID,
    DROP COLUMN Found_ID,
    ADD UNIQUE KEY uq_claim_match (Match_ID);

-- ขั้นที่ 4: ตรวจผล ต้องไม่มี Lost_ID / Found_ID แล้ว และต้องมีบรรทัด UNIQUE KEY `uq_claim_match` (`Match_ID`)
SHOW CREATE TABLE Claim;