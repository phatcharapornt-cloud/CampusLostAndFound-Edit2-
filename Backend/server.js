const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/auth');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

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
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});