const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ฟังก์ชันต์คำนวนความคล้ายของข้อความแบบเปรียบเทียบคำ (Keyword Overlap)
function calculateTextSimilarity(str1, str2){
    if (!str1 || !str2) return 0;
    const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    if (words1.length === 0 || words2.length === 0) return 0;
    let matchCount

}