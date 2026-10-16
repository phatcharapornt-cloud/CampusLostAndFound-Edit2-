// วาดข้อมูลรายการจับคู่สิ่งของ (ใช้ร่วมกันในหน้า matches.html และ historymatches.html)
// ใส่ในหน้า HTML ด้วย <script src="match-view.js"></script> ต่อจาก admin-session.js และ admin-layout.js
//
//   MatchView.itemCell('lost', match.lost, match.found)   กล่องข้อมูลสิ่งของที่หาย (ไฮไลต์หมวดหมู่/สถานที่ที่ตรงกับอีกฝั่ง)
//   MatchView.itemCell('found', match.found, match.lost)  กล่องข้อมูลสิ่งของที่พบ
//   MatchView.scoreCell(match)                             Match Score + คะแนนแยกแต่ละส่วน
// รูปภาพเป็นปุ่ม .mi-photo มี data-photo / data-caption ให้หน้าที่ใช้เปิดดูรูปใหญ่เอง
const MatchView = (() => {
    const esc = AdminLayout.escapeHtml;

    function photoUrl(path) {
        if (!path) return '';
        return /^https?:\/\//.test(path) ? path : `${AdminSession.API_BASE_URL}${path}`;
    }

    function formatDate(dateText, timeText) {
        if (!dateText) return '-';
        const [y, m, d] = dateText.split('-').map(Number);
        const date = new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
        return timeText ? `${date} ${timeText} น.` : date;
    }

    function formatScore(score) {
        return String(Number(Number(score).toFixed(2)));
    }

    function itemCell(kind, item, other) {
        const isLost = kind === 'lost';
        const id = isLost ? item.Lost_ID : item.Found_ID;
        const name = isLost ? item.LostItem_name : item.FoundItem_name;
        const desc = isLost ? item.Lost_description : item.Found_description;
        const photo = photoUrl(isLost ? item.Lost_photo : item.Found_photo);
        const when = isLost ? `หายเมื่อ ${formatDate(item.Lost_date, item.Lost_time)}` : `พบเมื่อ ${formatDate(item.Found_date, item.Found_time)}`;
        const sameCategory = other && other.Category_ID === item.Category_ID;
        const sameLocation = other && other.Location_ID === item.Location_ID;
        const photoHtml = photo
            ? `<button type="button" class="mi-photo" data-photo="${esc(photo)}" data-caption="${isLost ? 'สิ่งของที่หาย' : 'สิ่งของที่พบ'} #${esc(id)} ${esc(name)}" aria-label="ดูรูปของ${isLost ? 'สิ่งของที่หาย' : 'สิ่งของที่พบ'} ${esc(id)}"><img src="${esc(photo)}" alt="" loading="lazy"></button>`
            : '<div class="mi-nophoto"><i class="fa-regular fa-image"></i>ไม่มีรูป</div>';
        return `
            <div class="match-item">
                ${photoHtml}
                <div class="mi-info">
                    <span class="mi-kind ${isLost ? 'is-lost' : 'is-found'}">${isLost ? 'สิ่งของที่หาย' : 'สิ่งของที่พบ'}</span>
                    <div class="mi-ids">รหัสสิ่งของ <b>#${esc(id)}</b> · รหัสนักศึกษา <b>${esc(item.Student_ID || '-')}</b></div>
                    <div class="mi-name">${esc(name)}</div>
                    <div class="mi-meta"><i class="fa-solid fa-tag" aria-hidden="true"></i>${esc(item.Category_name || '-')}${sameCategory ? '<span class="same-tag">✓ ตรงกัน</span>' : ''}</div>
                    <div class="mi-meta"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${esc(item.Location_name || '-')}${sameLocation ? '<span class="same-tag">✓ ตรงกัน</span>' : ''}</div>
                    <div class="mi-desc">${esc(desc || '-')}</div>
                    <div class="mi-when">${esc(when)}</div>
                </div>
            </div>`;
    }

    function scoreCell(match) {
        const score = Number(match.Match_score);
        const mid = score < 90;
        const parts = match.breakdown ? match.breakdown.parts : null;
        const max = match.breakdown ? match.breakdown.max : null;
        const row = (label, key) => `<li><span>${label}</span><b>${formatScore(parts[key])}/${max[key]}</b></li>`;
        return `
            <div class="score-num${mid ? ' is-mid' : ''}">${esc(formatScore(score))}<small>%</small></div>
            <div class="score-bar${mid ? ' is-mid' : ''}"><span style="width:${Math.max(0, Math.min(100, score))}%"></span></div>
            ${parts ? `<ul class="score-parts" aria-label="คะแนนแยกแต่ละส่วน">
                ${row('หมวดหมู่', 'category')}
                ${row('สถานที่', 'location')}
                ${row('ชื่อสิ่งของ', 'name')}
                ${row('รายละเอียด', 'description')}
            </ul>` : ''}`;
    }

    // รูปเสีย (ไม่มีไฟล์ใน uploads) → แสดงกล่อง "รูปเสีย" แทน
    function bindBrokenPhotos(container) {
        container.querySelectorAll('.mi-photo img').forEach((img) => {
            img.addEventListener('error', () => {
                img.closest('.mi-photo').outerHTML = '<div class="mi-nophoto" title="ไม่พบไฟล์รูปในโฟลเดอร์ uploads"><i class="fa-solid fa-image"></i>รูปเสีย</div>';
            });
        });
    }

    return { photoUrl, formatDate, formatScore, itemCell, scoreCell, bindBrokenPhotos };
})();