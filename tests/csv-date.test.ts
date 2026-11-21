import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvDocument, formatCsvDate } from '../server/csv.ts';
import { dateToYmd, shiftYmd } from '../server/date.ts';

test('CSV date values display as DD-MM-YYYY', () => {
  assert.equal(formatCsvDate('2026-11-20'), '20-11-2026');
  assert.equal(formatCsvDate('not-a-date'), 'not-a-date');
});

test('CSV protects text cells from spreadsheet formulas and escapes quotes', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  for (const dangerous of ['+SUM(1,2)', '-1+2', '@SUM(A1:A2)', '\t=1+1', '  =1+1']) {
    assert.ok(csvCell(dangerous).startsWith('\"\''), `expected formula protection for ${JSON.stringify(dangerous)}`);
  }
  assert.equal(csvCell('A "quoted" value'), '"A ""quoted"" value"');
  assert.equal(csvCell(123), '"123"');
});

test('CSV document includes UTF-8 BOM and Windows-compatible line endings', () => {
  const csv = csvDocument([['Date', 'Title'], ['20-11-2026', 'Lunch']]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('\r\n'));
});

test('date-only values use the configured timezone rather than UTC', () => {
  const previous = process.env.APP_TIME_ZONE;
  process.env.APP_TIME_ZONE = 'Asia/Kolkata';
  try {
    assert.equal(dateToYmd(new Date('2026-11-19T19:00:00.000Z')), '2026-11-20');
  } finally {
    if (previous === undefined) delete process.env.APP_TIME_ZONE;
    else process.env.APP_TIME_ZONE = previous;
  }
});

test('date-only calendar arithmetic crosses month and year boundaries safely', () => {
  assert.equal(shiftYmd('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftYmd('2026-12-31', 1), '2027-01-01');
});
