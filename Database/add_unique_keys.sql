USE campus_lost_and_found;

-- ขั้นที่ 1: ตรวจว่าไม่มีข้อมูลซ้ำ (ทั้ง 3 คำสั่งต้องได้ผลว่าง Empty set)
-- คำสั่งที่ 1: หารายการจับคู่ที่ซ้ำ
SELECT Lost_ID, Found_ID, COUNT(*) AS n FROM MatchItem GROUP BY Lost_ID, Found_ID HAVING COUNT(*) > 1;
-- คำสั่งที่ 2: หาหมวดหมู่ชื่อซ้ำ
SELECT Category_name, COUNT(*) AS n FROM Category GROUP BY Category_name HAVING COUNT(*) > 1;
-- คำสั่งที่ 3: หาสถานที่ชื่อซ้ำ
SELECT Location_name, COUNT(*) AS n FROM Location GROUP BY Location_name HAVING COUNT(*) > 1;

-- ขั้นที่ 2: เพิ่ม UNIQUE
ALTER TABLE MatchItem ADD UNIQUE KEY uq_match_pair (Lost_ID, Found_ID);
ALTER TABLE Category ADD UNIQUE (Category_name);
ALTER TABLE Location ADD UNIQUE (Location_name);