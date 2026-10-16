const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/auth');
const resetPasswordRoutes = require('./routes/resetpassword');
const adminAuthRoutes = require('./routes/adminauth');
const adminDashboardRoutes = require('./routes/admindashboard');
const adminHistoryRoutes = require('./routes/adminhistory');
const adminNotificationRoutes = require('./routes/adminnotifications');
const itemSearchRoutes = require('./routes/itemsearch');
const myItemsRoutes = require('./routes/myitems');
const notificationRoutes = require('./routes/notifications');
const itemRoutes = require('./routes/item');
const matchRouter = require('./routes/matchitem');
const adminApproveRouter = require('./routes/adminapprovefound');
const claimRoutes = require('./routes/claimitem');
const { startFoundExpiryJob } = require('./service/foundstatus');

const app = express();

// Middleware
app.use(cors());
// เพิ่มขนาดสูงสุดของข้อมูลที่รับได้ (ค่าเริ่มต้น 100kb เล็กเกินไปสำหรับรูปภาพที่ส่งมาเป็น base64)
app.use(express.json({ limit: '8mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', resetPasswordRoutes); // ลืมรหัสผ่าน: /api/auth/request-reset, /verify-otp, /reset-password
app.use('/api/auth', adminAuthRoutes);     // Admin: /api/auth/admin-login, /admin-me
app.use('/api/items', itemRoutes);
app.use('/api/items', itemSearchRoutes);     // หน้าแรกผู้ใช้: /api/items/found/recent, /api/items/found/search
app.use('/api/items', myItemsRoutes);        // รายการของฉัน: /api/items/my
app.use('/api/notifications', notificationRoutes); // การแจ้งเตือนของผู้ใช้: /api/notifications, /unread-count, /read-all
app.use('/api/match', matchRouter);
app.use('/api/admin', adminApproveRouter);
app.use('/api/admin', adminDashboardRoutes); // หน้าหลัก Web-Admin: /api/admin/summary
app.use('/api/admin', adminHistoryRoutes);   // History ของ Web-Admin: /api/admin/history/lost, /history/found
app.use('/api/admin', adminNotificationRoutes); // กระดิ่งแจ้งเตือนของ Admin: /api/admin/notifications
app.use('/api/claim', claimRoutes);

// เปิดให้เข้าถึงไฟล์รูปภาพในโฟลเดอร์ uploads ผ่าน URL ได้
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API หน้าแรกสำหรับทดสอบระบบ
app.get('/', (req, res) => {
  res.send('Campus Lost and Found API is running...');
});

// API ทดสอบดึงข้อมูล Category จาก MySQL จริง
app.get('/api/test-categories', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM Category');
    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ข้อมูลที่ส่งมาใหญ่เกินไป หรือ JSON ผิดรูปแบบ → ตอบเป็น JSON ภาษาไทยแทนหน้า error ของ Express
app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'ข้อมูลหรือไฟล์รูปภาพมีขนาดใหญ่เกินไป' });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง' });
  }
  next(error);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, (error) => {
  // Express 5 เรียกฟังก์ชันนี้แม้เปิดเซิร์ฟเวอร์ไม่สำเร็จ (เช่น มีเซิร์ฟเวอร์อีกตัวใช้ PORT นี้อยู่) จึงต้องเช็ก error ก่อน
  if (error) {
    console.error(`❌ เปิดเซิร์ฟเวอร์ไม่สำเร็จ: ${error.code === 'EADDRINUSE' ? `PORT ${PORT} ถูกใช้งานอยู่ (อาจเปิด Backend ซ้อนไว้อีกหน้าต่าง)` : error.message}`);
    process.exit(1);
  }
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  // สิ่งของที่พบที่ 'รอการอนุมัติ' เกิน 30 นาที → 'ถูกปฏิเสธ' อัตโนมัติ + แจ้งเตือนผู้ใช้ (ตรวจทุก 1 นาที)
  startFoundExpiryJob();
});