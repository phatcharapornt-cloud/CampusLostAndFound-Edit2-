// ฟังก์ชันตรวจสอบข้อมูลการสมัครสมาชิก (Signup)
// หมายเหตุ: เงื่อนไขชุดเดียวกันนี้ถูกตรวจซ้ำในหน้า App-user/register.html ด้วย ถ้าแก้ที่นี่ต้องแก้ที่นั่นให้ตรงกัน

// รหัสนักศึกษา KMITL เป็นตัวเลข 8 หลัก
const STUDENT_ID_PATTERN = /^\d{8}$/;

// อีเมลของมหาวิทยาลัยต้องอยู่ในรูปแบบ รหัสนักศึกษา@kmitl.ac.th
const UNIVERSITY_EMAIL_DOMAIN = 'kmitl.ac.th';

// ชื่อ/นามสกุล: ภาษาไทยหรือภาษาอังกฤษ เว้นวรรค จุด ขีด และ ' ได้ (ความยาวตามคอลัมน์ VARCHAR(50))
const NAME_PATTERN = /^[฀-๿a-zA-Z .'-]+$/;
const NAME_MAX_LENGTH = 50;

// รหัสผ่าน: ใช้ได้เฉพาะอักขระ ASCII ที่พิมพ์ได้ (ไม่มีช่องว่าง ไม่มีภาษาไทย)
const PASSWORD_ALLOWED_PATTERN = /^[\x21-\x7E]*$/;
// อักขระพิเศษ = เครื่องหมายวรรคตอน ASCII ทั้งหมด เช่น ! @ # $ % ^ & * ( ) - _ = + [ ] { } ; : ' " , . < > / ? \ | ` ~
const SPECIAL_CHAR_PATTERN = /[!-\/:-@\[-`{-~]/;

const PASSWORD_RULES = [
    { key: 'length',  message: 'ความยาว 8-16 ตัวอักษร',                 test: (p) => p.length >= 8 && p.length <= 16 },
    { key: 'upper',   message: 'มีตัวอักษรพิมพ์ใหญ่อย่างน้อย 1 ตัว (A-Z)', test: (p) => /[A-Z]/.test(p) },
    { key: 'lower',   message: 'มีตัวอักษรพิมพ์เล็กอย่างน้อย 1 ตัว (a-z)', test: (p) => /[a-z]/.test(p) },
    { key: 'digit',   message: 'มีตัวเลขอย่างน้อย 1 ตัว (0-9)',           test: (p) => /[0-9]/.test(p) },
    { key: 'special', message: 'มีอักขระพิเศษอย่างน้อย 1 ตัว',           test: (p) => SPECIAL_CHAR_PATTERN.test(p) },
];

// แปลงค่าที่รับมาให้เป็น string (รองรับกรณีส่งรหัสนักศึกษามาเป็นตัวเลข)
function toText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '';
}

function validateName(name, label) {
    if (!name) return `กรุณากรอก${label}`;
    if (name.length > NAME_MAX_LENGTH) return `${label}ต้องไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร`;
    if (!NAME_PATTERN.test(name)) return `${label}ใช้ได้เฉพาะตัวอักษรภาษาไทยหรือภาษาอังกฤษ`;
    return null;
}

function validateStudentId(studentId) {
    if (!studentId) return 'กรุณากรอกรหัสนักศึกษา';
    if (!STUDENT_ID_PATTERN.test(studentId)) return 'รหัสนักศึกษาต้องเป็นตัวเลข 8 หลัก';
    return null;
}

function validateEmail(email, studentId) {
    if (!email) return 'กรุณากรอกอีเมล';
    if (!email.endsWith(`@${UNIVERSITY_EMAIL_DOMAIN}`)) {
        return `กรุณาใช้อีเมลของมหาวิทยาลัย (@${UNIVERSITY_EMAIL_DOMAIN})`;
    }
    if (studentId && email !== `${studentId}@${UNIVERSITY_EMAIL_DOMAIN}`) {
        return `อีเมลต้องตรงกับรหัสนักศึกษา (${studentId}@${UNIVERSITY_EMAIL_DOMAIN})`;
    }
    return null;
}

// คืนค่ารายการเงื่อนไขรหัสผ่านที่ยังไม่ผ่าน (array ว่าง = ผ่านทั้งหมด)
function getFailedPasswordRules(password) {
    return PASSWORD_RULES.filter((rule) => !rule.test(password));
}

function validatePassword(password) {
    if (!password) return 'กรุณากรอกรหัสผ่าน';
    if (!PASSWORD_ALLOWED_PATTERN.test(password)) {
        return 'รหัสผ่านใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และอักขระพิเศษ (ห้ามมีช่องว่างหรือภาษาไทย)';
    }
    const failed = getFailedPasswordRules(password);
    if (failed.length > 0) {
        return `รหัสผ่านยังไม่ผ่านเงื่อนไข: ${failed.map((rule) => rule.message).join(', ')}`;
    }
    return null;
}

// ตรวจสอบข้อมูลสมัครสมาชิกทั้งหมด
// คืนค่า { values: ข้อมูลที่จัดรูปแบบแล้ว, errors: { ชื่อฟิลด์: ข้อความ } }
function validateRegistration(body) {
    const values = {
        FName: toText(body.FName).trim(),
        LName: toText(body.LName).trim(),
        Student_ID: toText(body.Student_ID).trim(),
        Email: toText(body.Email).trim().toLowerCase(),
        Password: toText(body.Password), // รหัสผ่านไม่ตัดช่องว่าง เพื่อไม่ให้รหัสที่ผู้ใช้ตั้งเปลี่ยนไป
    };

    const studentIdError = validateStudentId(values.Student_ID);
    const checks = {
        FName: validateName(values.FName, 'ชื่อ'),
        LName: validateName(values.LName, 'นามสกุล'),
        Student_ID: studentIdError,
        // ถ้ารหัสนักศึกษาผิดรูปแบบ จะตรวจแค่โดเมนอีเมล ไม่เทียบกับรหัสนักศึกษา
        Email: validateEmail(values.Email, studentIdError ? null : values.Student_ID),
        Password: validatePassword(values.Password),
    };

    const errors = {};
    for (const [field, message] of Object.entries(checks)) {
        if (message) errors[field] = message;
    }

    return { values, errors };
}

// ตรวจสอบข้อมูลเข้าสู่ระบบ (Login) ด้วยรหัสนักศึกษาและรหัสผ่าน
// ตรวจแค่รูปแบบรหัสนักศึกษาและว่ากรอกรหัสผ่านแล้ว ไม่ตรวจเงื่อนไขความปลอดภัยของรหัสผ่านซ้ำ
// (ความถูกต้องของรหัสผ่านตรวจด้วย bcrypt ใน routes/auth.js)
function validateLogin(body) {
    const values = {
        Student_ID: toText(body.Student_ID).trim(),
        Password: toText(body.Password),
    };

    const errors = {};
    const studentIdError = validateStudentId(values.Student_ID);
    if (studentIdError) errors.Student_ID = studentIdError;
    if (!values.Password) errors.Password = 'กรุณากรอกรหัสผ่าน';

    return { values, errors };
}

// ---------- เปลี่ยนรหัสผ่าน (Reset Password) ----------

// รหัส OTP เป็นตัวเลข 6 หลัก
const OTP_PATTERN = /^\d{6}$/;

function validateOtp(otp) {
    if (!otp) return 'กรุณากรอกรหัส OTP';
    if (!OTP_PATTERN.test(otp)) return 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก';
    return null;
}

// รวมผลตรวจของแต่ละฟิลด์ให้เป็น { ชื่อฟิลด์: ข้อความ } (เก็บเฉพาะฟิลด์ที่ไม่ผ่าน)
function collectErrors(checks) {
    const errors = {};
    for (const [field, message] of Object.entries(checks)) {
        if (message) errors[field] = message;
    }
    return errors;
}

// ขั้นที่ 1: ขอรหัส OTP ด้วยรหัสนักศึกษา
function validateResetRequest(body) {
    const values = { Student_ID: toText(body.Student_ID).trim() };
    return { values, errors: collectErrors({ Student_ID: validateStudentId(values.Student_ID) }) };
}

// ขั้นที่ 2: ยืนยันรหัส OTP
function validateOtpVerification(body) {
    const values = {
        Student_ID: toText(body.Student_ID).trim(),
        OTP: toText(body.OTP).trim(),
    };
    return {
        values,
        errors: collectErrors({
            Student_ID: validateStudentId(values.Student_ID),
            OTP: validateOtp(values.OTP),
        }),
    };
}

// ขั้นที่ 3: ตั้งรหัสผ่านใหม่ (ใช้เงื่อนไขความปลอดภัยชุดเดียวกับตอนสมัครสมาชิก)
function validatePasswordReset(body) {
    const values = {
        Student_ID: toText(body.Student_ID).trim(),
        OTP: toText(body.OTP ?? body.resetToken).trim(), // รองรับชื่อเดิม resetToken ด้วย
        NewPassword: toText(body.NewPassword),
    };
    return {
        values,
        errors: collectErrors({
            Student_ID: validateStudentId(values.Student_ID),
            OTP: validateOtp(values.OTP),
            NewPassword: validatePassword(values.NewPassword),
        }),
    };
}

// ---------- เข้าสู่ระบบผู้ดูแลระบบ (Admin) ----------

// รูปแบบอีเมลทั่วไป (Admin ไม่จำเป็นต้องเป็นอีเมลนักศึกษา) ยาวไม่เกิน VARCHAR(50)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_EMAIL_MAX_LENGTH = 50;

function validateAdminEmail(email) {
    if (!email) return 'กรุณากรอกอีเมล';
    if (email.length > ADMIN_EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) return 'รูปแบบอีเมลไม่ถูกต้อง';
    return null;
}

// ตรวจแค่ว่ากรอกครบและอีเมลถูกรูปแบบ (ความถูกต้องของรหัสผ่านตรวจใน routes/adminauth.js)
function validateAdminLogin(body) {
    const values = {
        Admin_email: toText(body.Admin_email).trim().toLowerCase(),
        Admin_password: toText(body.Admin_password),
    };
    return {
        values,
        errors: collectErrors({
            Admin_email: validateAdminEmail(values.Admin_email),
            Admin_password: values.Admin_password ? null : 'กรุณากรอกรหัสผ่าน',
        }),
    };
}

// ---------- แจ้งสิ่งของที่หาย (Lost Item) ----------
// หมายเหตุ: หน้า App-user/reportlost.html ตรวจเงื่อนไขชุดเดียวกันนี้ด้วย ถ้าแก้ที่นี่ต้องแก้ที่นั่นให้ตรงกัน

// ความยาวตามคอลัมน์ในตาราง LostItem (LostItem_name VARCHAR(100), Lost_description VARCHAR(200))
const ITEM_NAME_MAX_LENGTH = 100;
const ITEM_DESCRIPTION_MAX_LENGTH = 200;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
// เผื่อนาฬิกาของเครื่องผู้ใช้กับเซิร์ฟเวอร์ต่างกันเล็กน้อย
const CLOCK_SKEW_MINUTES = 5;

// เลขจำนวนเต็มบวก (รับได้ทั้งตัวเลขและข้อความตัวเลข) ไม่ใช่ → null
function toPositiveInt(value) {
    const text = toText(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// วันที่ปัจจุบันตามเวลาเครื่องเซิร์ฟเวอร์ ในรูปแบบ YYYY-MM-DD
function localDateText(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function validateItemDate(dateText, now) {
    if (!dateText) return 'กรุณาเลือกวันที่';
    const match = DATE_PATTERN.exec(dateText);
    if (!match) return 'รูปแบบวันที่ไม่ถูกต้อง';
    const [, y, m, d] = match.map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d || y < 2000) {
        return 'รูปแบบวันที่ไม่ถูกต้อง';
    }
    if (dateText > localDateText(now)) return 'วันที่ต้องไม่เกินวันนี้';
    return null;
}

function validateItemTime(timeText, dateText, now) {
    if (!timeText) return 'กรุณาเลือกเวลา';
    const match = TIME_PATTERN.exec(timeText);
    if (!match) return 'รูปแบบเวลาไม่ถูกต้อง';
    // ถ้าเป็นวันนี้ เวลาต้องไม่เกินเวลาปัจจุบัน
    if (dateText === localDateText(now)) {
        const minutes = Number(match[1]) * 60 + Number(match[2]);
        if (minutes > now.getHours() * 60 + now.getMinutes() + CLOCK_SKEW_MINUTES) return 'เวลาต้องไม่เกินเวลาปัจจุบัน';
    }
    return null;
}

function validateRequiredText(text, label, maxLength) {
    if (!text) return `กรุณากรอก${label}`;
    if (text.length > maxLength) return `${label}ต้องไม่เกิน ${maxLength} ตัวอักษร`;
    return null;
}

// ตรวจข้อมูลการแจ้งสิ่งของที่หาย (รูปภาพไม่บังคับ ตรวจไฟล์รูปแยกใน utils/imageupload.js)
// คืนค่า { values, errors } เหมือนฟังก์ชันอื่นในไฟล์นี้
function validateLostItemReport(body, now = new Date()) {
    const values = {
        User_ID: toPositiveInt(body.User_ID),
        LostItem_name: toText(body.LostItem_name).trim(),
        Category_ID: toPositiveInt(body.Category_ID),
        Location_ID: toPositiveInt(body.Location_ID),
        Lost_date: toText(body.Lost_date).trim(),
        Lost_time: toText(body.Lost_time).trim(),
        Lost_description: toText(body.Lost_description).trim(),
        Lost_photo: typeof body.Lost_photo === 'string' ? body.Lost_photo : '',
    };
    const dateError = validateItemDate(values.Lost_date, now);

    return {
        values,
        errors: collectErrors({
            User_ID: values.User_ID ? null : 'ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่',
            LostItem_name: validateRequiredText(values.LostItem_name, 'ชื่อสิ่งของ', ITEM_NAME_MAX_LENGTH),
            Category_ID: values.Category_ID ? null : 'กรุณาเลือกหมวดหมู่ของสิ่งของ',
            Location_ID: values.Location_ID ? null : 'กรุณาเลือกสถานที่ที่คาดว่าทำของหาย',
            Lost_date: dateError,
            // ถ้าวันที่ผิด ตรวจแค่รูปแบบเวลา ไม่เทียบกับเวลาปัจจุบัน
            Lost_time: validateItemTime(values.Lost_time, dateError ? null : values.Lost_date, now),
            Lost_description: validateRequiredText(values.Lost_description, 'รายละเอียดเพิ่มเติม', ITEM_DESCRIPTION_MAX_LENGTH),
        }),
    };
}

module.exports = {
    ITEM_NAME_MAX_LENGTH,
    ITEM_DESCRIPTION_MAX_LENGTH,
    validateLostItemReport,
    STUDENT_ID_PATTERN,
    UNIVERSITY_EMAIL_DOMAIN,
    PASSWORD_RULES,
    getFailedPasswordRules,
    validatePassword,
    validateAdminEmail,
    validateAdminLogin,
    validateRegistration,
    validateLogin,
    validateResetRequest,
    validateOtpVerification,
    validatePasswordReset,
};