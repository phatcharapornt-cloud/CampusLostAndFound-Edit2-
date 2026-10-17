// สร้างข้อความแจ้งเตือนที่มีชื่อสิ่งของ ให้ไม่เกินความยาวของคอลัมน์ Notification.Message (VARCHAR(200))
// ถ้ายาวเกิน จะตัดชื่อสิ่งของให้สั้นลงแล้วต่อท้ายด้วย "…"
//   withItemName((name) => `ท่านได้รับสิ่งของ "${name}" คืนแล้ว`, 'กระเป๋าสตางค์')
const MESSAGE_MAX_LENGTH = 200;

function withItemName(build, itemName) {
    const name = String(itemName ?? '');
    const room = MESSAGE_MAX_LENGTH - build('').length;
    return build(name.length > room ? `${name.slice(0, Math.max(0, room - 1))}…` : name);
}

module.exports = { MESSAGE_MAX_LENGTH, withItemName };