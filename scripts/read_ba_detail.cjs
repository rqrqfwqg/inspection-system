const XLSX = require('C:/Users/yan/WorkBuddy/2026-05-21-13-28-45/inspection-system/node_modules/xlsx');
const path = require('path');

const base = 'D:/机场业务/T3GTC/02_设备清单/';

function dumpSheet(fp, sheetName, maxRows) {
  const wb = XLSX.readFile(fp, { type: 'file', cellDates: true });
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  console.log('\n===== Sheet:', sheetName, '| rows:', rows.length, '=====');
  // find header row (first row where most cells non-empty)
  let hIdx = rows.findIndex(r => r && r.filter(c => c !== null && c !== '').length >= 3);
  if (hIdx < 0) hIdx = 0;
  const header = rows[hIdx] || [];
  console.log('Header row #' + (hIdx + 1) + ' (' + header.length + ' cols):');
  header.forEach((h, i) => console.log('  [' + i + '] ' + (h === null ? '∅' : String(h))));
  const dataRows = rows.slice(hIdx + 1).filter(r => r && r.some(c => c !== null && c !== ''));
  console.log('Data rows (non-empty):', dataRows.length);
  dataRows.slice(0, maxRows || 4).forEach((r, ri) => {
    console.log('  --- sample ' + (ri + 1) + ' ---');
    header.forEach((h, i) => {
      const v = r[i];
      if (v !== null && v !== undefined && v !== '') console.log('    ' + (h === null ? '∅' : String(h)) + ' = ' + String(v));
    });
  });
}

// File 3 BA system
const f3 = path.join(base, 'BA系统设备清单_整理汇总.xlsx');
const baSheets = ['设备总览统计', '问题清单', 'VRV空调', '一体化空调', '一氧化碳检测', '市政排风', '潜污泵', '排风机', '管廊气体监测'];
for (const s of baSheets) {
  try { dumpSheet(f3, s, 3); } catch (e) { console.log('ERR', s, e.message); }
}

// File 1 原始数据 full columns (col count check)
console.log('\n\n########## 电柜 原始数据 列数确认 ##########');
const f1 = path.join(base, 'GTC和停车楼电柜清单-统计汇总.xlsx');
const wb1 = XLSX.readFile(f1, { type: 'file', cellDates: true });
const ws1 = wb1.Sheets['原始数据'];
const r1 = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: null, raw: false });
console.log('原始数据 total rows:', r1.length, 'max cols in row2:', (r1[1] || []).length);
// check if any row beyond col 9 has data
let maxCol = 0;
r1.forEach(r => { if (r) maxCol = Math.max(maxCol, r.length); });
console.log('Max columns across all rows:', maxCol);
