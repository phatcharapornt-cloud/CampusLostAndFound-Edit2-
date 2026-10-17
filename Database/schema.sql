CREATE DATABASE IF NOT EXISTS campus_lost_and_found CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE campus_lost_and_found;

-- 1.ตารางข้อมูลผู้ใช้งาน (User)
CREATE TABLE IF NOT EXISTS User (
    User_ID INT AUTO_INCREMENT PRIMARY KEY,
    FName VARCHAR(50) NOT NULL,
    LName VARCHAR(50) NOT NULL,
    Student_ID VARCHAR(20) NOT NULL UNIQUE,
    Email VARCHAR(50) NOT NULL UNIQUE,
    Password VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- 2.ตารางข้อมูลเจ้าหน้าที่ (Admin)
CREATE TABLE IF NOT EXISTS Admin (
    Admin_ID INT AUTO_INCREMENT PRIMARY KEY,
    Admin_email VARCHAR(50) NOT NULL UNIQUE,
    Admin_password VARCHAR(255) NOT NULL
) ENGINE=InnoDB;
-- เพิ่มบัญชี Admin (ไม่มีหน้าสมัคร) รหัสผ่านเก็บตามที่พิมพ์ เช่น
-- INSERT INTO Admin (Admin_email, Admin_password) VALUES ('newadmin@kmitl.ac.th', 'Admin*1234');

-- 3.ตารางข้อมูลหมวดหมู่ของสิ่งของ (Category)
CREATE TABLE IF NOT EXISTS Category (
    Category_ID INT AUTO_INCREMENT PRIMARY KEY,
    Category_name VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- 4.ตารางข้อมูลสถานที่ (Location)
CREATE TABLE IF NOT EXISTS Location (
    Location_ID INT AUTO_INCREMENT PRIMARY KEY,
    Location_name VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- 5.ตารางข้อมูลการขอเปลี่ยนรหัสผ่าน (ResetPassword)
CREATE TABLE IF NOT EXISTS ResetPassword (
    ResetPassword_ID VARCHAR(20) PRIMARY KEY,
    User_ID INT NOT NULL,
    Request_code VARCHAR(20) NOT NULL,
    Datetime_at DATETIME NOT NULL default CURRENT_TIMESTAMP,
    Is_used BOOLEAN NOT NULL default FALSE,
    FOREIGN KEY (User_ID) REFERENCES User(User_ID) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6.ตารางข้อมูลสิ่งของที่หาย (LostItem)
CREATE TABLE IF NOT EXISTS LostItem (
    Lost_ID INT AUTO_INCREMENT PRIMARY KEY,
    User_ID INT NOT NULL,
    Category_ID INT NOT NULL,
    Location_ID INT NOT NULL,
    LostItem_name VARCHAR(100) NOT NULL,
    Lost_date DATE NOT NULL,
    Lost_time TIME NULL,
    Lost_description VARCHAR(200) NOT NULL,
    Lost_photo VARCHAR(255) NULL,
    Lost_status ENUM('พบ', 'ไม่พบ','ยกเลิกรายการ','ได้รับสิ่งของคืนแล้ว') NOT NULL DEFAULT 'ไม่พบ',
    FOREIGN KEY (User_ID) REFERENCES User(User_ID) ON DELETE CASCADE,
    FOREIGN KEY (Category_ID) REFERENCES Category(Category_ID),
    FOREIGN KEY (Location_ID) REFERENCES Location(Location_ID)
) ENGINE=InnoDB;

-- 7.ตารางข้อมูลสิ่งของที่พบ (FoundItem)
CREATE TABLE IF NOT EXISTS FoundItem (
    Found_ID INT AUTO_INCREMENT PRIMARY KEY,
    User_ID INT NOT NULL,
    Admin_ID INT NULL,
    Category_ID INT NOT NULL,
    Location_ID INT NOT NULL,
    FoundItem_name VARCHAR(100) NOT NULL,
    Found_date DATE NOT NULL,
    Found_time TIME NOT NULL,
    Found_description VARCHAR(200) NOT NULL,
    Found_photo VARCHAR(255) NOT NULL,
    Found_status ENUM('รอการอนุมัติ', 'อนุมัติแล้ว' ,'ถูกปฏิเสธ', 'คืนสิ่งของแล้ว') NOT NULL DEFAULT 'รอการอนุมัติ',
    Foundcheck_at DATETIME NOT NULL Default CURRENT_TIMESTAMP,
    FOREIGN KEY (User_ID) REFERENCES User(User_ID) ON DELETE CASCADE,
    FOREIGN KEY (Admin_ID) REFERENCES Admin(Admin_ID),
    FOREIGN KEY (Category_ID) REFERENCES Category(Category_ID),
    FOREIGN KEY (Location_ID) REFERENCES Location(Location_ID)
) ENGINE=InnoDB;

-- 8.ตารางข้อมูลการจับคู่สิ่งของที่หายและสิ่งของที่พบ (MatchItem)
CREATE TABLE IF NOT EXISTS MatchItem (
    Match_ID INT AUTO_INCREMENT PRIMARY KEY,
    Lost_ID INT NOT NULL,
    Found_ID INT NOT NULL,
    Match_score DECIMAL(5,2) NOT NULL,
    Match_status ENUM('ส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน','ปฏิเสธการส่งรายการจับคู่สิ่งของไปยังผู้ใช้งาน','ผู้ใช้งานปฏิเสธการขอรับสิ่งของคืน', 'ผู้ใช้งานยืนยันการขอรับสิ่งของคืน') DEFAULT NULL,
    Match_date DATE NOT NULL default (CURRENT_DATE),
    Match_time TIME NOT NULL default (CURRENT_TIME),
    FOREIGN KEY (Lost_ID) REFERENCES LostItem(Lost_ID) ON DELETE CASCADE,
    FOREIGN KEY (Found_ID) REFERENCES FoundItem(Found_ID) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 9.ตารางข้อมูลการขอรับสิ่งของคืน (Claim)
CREATE TABLE IF NOT EXISTS Claim (
    Claim_ID INT AUTO_INCREMENT PRIMARY KEY,
    User_ID INT NOT NULL,
    Admin_ID INT NULL,
    Match_ID INT NOT NULL,
    Lost_ID INT NOT NULL,
    Found_ID INT NOT NULL,
    Claim_detail VARCHAR(200) NOT NULL,
    Claim_status ENUM('รอการอนุมัติ', 'อนุมัติ', 'ปฏิเสธ','คืนสิ่งของแล้ว') NOT NULL DEFAULT 'รอการอนุมัติ',
    Claim_date DATE NOT NULL,
    Claimcheck_at DATETIME NULL Default NULL,
    FOREIGN KEY (User_ID) REFERENCES User(User_ID) ON DELETE CASCADE,
    FOREIGN KEY (Match_ID) REFERENCES MatchItem(Match_ID) ON DELETE CASCADE,
    FOREIGN KEY (Lost_ID) REFERENCES LostItem(Lost_ID) ON DELETE CASCADE,
    FOREIGN KEY (Found_ID) REFERENCES FoundItem(Found_ID) ON DELETE CASCADE,
    FOREIGN KEY (Admin_ID) REFERENCES Admin(Admin_ID)
) ENGINE=InnoDB;

-- 10.ตารางข้อมูลการแจ้งเตือน (Notification)
CREATE TABLE IF NOT EXISTS Notification (
    Notification_ID INT AUTO_INCREMENT PRIMARY KEY,
    User_ID INT NULL,
    Admin_ID INT NULL,
    Lost_ID INT NULL,
    Match_ID INT NULL,
    Found_ID INT NULL,
    Claim_ID INT NULL,
    Message VARCHAR(200) NOT NULL,
    Is_read BOOLEAN NOT NULL Default FALSE,
    Notice_at DATETIME NOT NULL Default CURRENT_TIMESTAMP,
    FOREIGN KEY (Admin_ID) REFERENCES Admin(Admin_ID) ON DELETE CASCADE,
    FOREIGN KEY (Lost_ID) REFERENCES LostItem(Lost_ID) ON DELETE CASCADE,
    FOREIGN KEY (Match_ID) REFERENCES MatchItem(Match_ID) ON DELETE CASCADE,
    FOREIGN KEY (Found_ID) REFERENCES FoundItem(Found_ID) ON DELETE CASCADE,
    FOREIGN KEY (Claim_ID) REFERENCES Claim(Claim_ID) ON DELETE CASCADE
) ENGINE=InnoDB;