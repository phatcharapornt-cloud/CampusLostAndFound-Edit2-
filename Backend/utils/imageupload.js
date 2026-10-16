// บันทึกรูปภาพที่หน้าเว็บส่งมาเป็น Data URL (data:image/jpeg;base64,....) ลงโฟลเดอร์ Backend/uploads
//
// วิธีใช้:
//   const { parseImageDataUrl, saveImage, removeUpload } = require('../utils/imageupload');
//   const image = parseImageDataUrl(req.body.Lost_photo);   // { error } ถ้าไม่ผ่าน
//   const photoPath = saveImage(image, 'lost');             // → '/uploads/lost_1760000000000_ab12cd34.jpg'
//   removeUpload(photoPath);                                // ลบไฟล์ทิ้ง (เช่น บันทึกฐานข้อมูลไม่สำเร็จ)
//
// ความปลอดภัย: รับเฉพาะ JPG / PNG / WEBP / GIF และตรวจจากเนื้อไฟล์จริง (ไม่เชื่อแค่ชนิดที่หน้าเว็บบอกมา)
// เพราะไฟล์ใน uploads เปิดดูผ่าน URL ได้ ถ้ารับไฟล์ HTML/SVG ปลอมเป็นรูป อาจถูกใช้ฝังสคริปต์อันตรายได้
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB หลังถอดรหัส base64

// ตรวจชนิดไฟล์จากไบต์แรก ๆ ของไฟล์ (magic number)
const IMAGE_TYPES = [
    { ext: 'jpg',  test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: 'png',  test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { ext: 'gif',  test: (b) => b.length > 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a') },
    { ext: 'webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

const DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|gif|webp);base64,([A-Za-z0-9+/=\r\n]+)$/;

// ตรวจ Data URL → { buffer, ext } หรือ { error: ข้อความภาษาไทย }
function parseImageDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl) return { error: 'ไม่พบไฟล์รูปภาพ' };

    const match = DATA_URL_PATTERN.exec(dataUrl);
    if (!match) return { error: 'รองรับเฉพาะไฟล์รูปภาพ JPG, PNG, WEBP หรือ GIF' };

    // ประมาณขนาดจากความยาว base64 ก่อนถอดรหัส จะได้ไม่ต้องจองหน่วยความจำให้ไฟล์ที่ใหญ่เกิน
    if (Math.floor(match[2].length * 3 / 4) > MAX_IMAGE_BYTES + 3) {
        return { error: `ไฟล์รูปภาพต้องมีขนาดไม่เกิน ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0) return { error: 'ไฟล์รูปภาพเสียหาย กรุณาเลือกรูปใหม่' };
    if (buffer.length > MAX_IMAGE_BYTES) {
        return { error: `ไฟล์รูปภาพต้องมีขนาดไม่เกิน ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
    }

    const type = IMAGE_TYPES.find((t) => t.test(buffer));
    if (!type) return { error: 'ไฟล์ที่เลือกไม่ใช่รูปภาพ หรือไฟล์เสียหาย กรุณาเลือกรูปใหม่' };

    return { buffer, ext: type.ext };
}

// บันทึกรูป (ผลจาก parseImageDataUrl) แล้วคืน path สั้น ๆ สำหรับเก็บในฐานข้อมูล เช่น /uploads/lost_1760000000000_ab12cd34.jpg
function saveImage(image, prefix) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    // ใส่เลขสุ่มต่อท้าย กันชื่อไฟล์ซ้ำเมื่อมีคนอัปโหลดพร้อมกันในมิลลิวินาทีเดียวกัน
    const fileName = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${image.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), image.buffer);
    return `/uploads/${fileName}`;
}

// ลบไฟล์ที่บันทึกไว้ (ใช้ตอนบันทึกฐานข้อมูลไม่สำเร็จ จะได้ไม่มีไฟล์ค้าง)
function removeUpload(publicPath) {
    if (!publicPath || !publicPath.startsWith('/uploads/')) return;
    const fileName = path.basename(publicPath);
    fs.rm(path.join(UPLOAD_DIR, fileName), { force: true }, () => { /* ลบไม่ได้ก็ไม่เป็นไร */ });
}

module.exports = {
    MAX_IMAGE_BYTES,
    parseImageDataUrl,
    saveImage,
    removeUpload,
};