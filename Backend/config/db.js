const mysql = require('mysql2/promise');
require('dotenv').config();

// สร้าง Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ทดสอบการเชื่อมต่อ
pool.getConnection()
  .then(connection => {
    console.log('✅ Connected to MySQL Database successfully!');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

module.exports = pool;