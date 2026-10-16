const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/item');
const matchRouter = require('./routes/matchitem');
const adminApproveRouter = require('./routes/adminapprovefound');
const claimRoutes = require('./routes/claimitem');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/match', matchRouter);
app.use('/api/admin', adminApproveRouter);
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, (error) => {
  // Express 5 เรียกฟังก์ชันนี้แม้เปิดเซิร์ฟเวอร์ไม่สำเร็จ (เช่น มีเซิร์ฟเวอร์อีกตัวใช้ PORT นี้อยู่) จึงต้องเช็ก error ก่อน
  if (error) {
    console.error(`❌ เปิดเซิร์ฟเวอร์ไม่สำเร็จ: ${error.code === 'EADDRINUSE' ? `PORT ${PORT} ถูกใช้งานอยู่ (อาจเปิด Backend ซ้อนไว้อีกหน้าต่าง)` : error.message}`);
    process.exit(1);
  }
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});