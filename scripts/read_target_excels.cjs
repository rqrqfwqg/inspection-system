const XLSX = require('C:/Users/yan/WorkBuddy/2026-05-21-13-28-45/inspection-system/node_modules/xlsx');
const path = require('path');

const base = 'D:/机场业务/T3GTC/02_设备清单/';
const files = [
  'GTC和停车楼电柜清单-统计汇总.xlsx',
  '机房信息汇总.xlsx',
  'BA系统设备清单_整理汇总.xlsx',
];

for (const f of files) {
  const fp = path.join(base, f);
  console.log('\n================================================================');
  console.log('FILE:', f);
  console.log('================================================================');
  let wb;
  try {
    wb = XLSX.readFile(fp, { type: 'file', cellDates: true });
  } catch (e) {
    console.log('  ERROR reading:', e.message);
    continue;
  }
  console.log('Sheets (' + wb.SheetNames.length + '):', wb.SheetNames.join(' | '));
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
    console.log('\n  ---- Sheet:', name, '| total rows:', rows.length, '----');
    // header = first non-empty row
    let hIdx = rows.findIndex(r => r && r.some(c => c !== null && c !== ''));
    const header = rows[hIdx] || [];
    console.log('  Header row #' + (hIdx + 1) + ' (' + header.length + ' cols):');
    header.forEach((h, i) => console.log('    [' + i + '] ' + (h === null ? '∅' : String(h))));
    // sample 6 data rows
    const dataRows = rows.slice(hIdx + 1).filter(r => r && r.some(c => c !== null && c !== ''));
    console.log('  Data rows count (non-empty):', dataRows.length);
    const sample = dataRows.slice(0, 6);
    sample.forEach((r, ri) => {
      console.log('  Row' + (hIdx + 1 + ri + 1) + ':');
      header.forEach((h, i) => {
        const v = r[i];
        console.log('      ' + (h === null ? '∅' : String(h)) + ' = ' + (v === null || v === undefined ? '∅' : String(v)));
      });
    });
  }
}
