/**
 * Small, strict CSV utilities shared by the sheet editor and the agent tool.
 *
 * RFC 4180 behaviour that matters here: quoted fields may contain commas,
 * doubled quotes, and newlines. Parsing stops cleanly on ragged rows instead of
 * inventing cells, so importing a malformed table cannot silently shift a
 * column of numbers.
 */

export function parseCsv(input: string): string[][] {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index++;
        continue;
      }
      field += char;
      index++;
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
      index++;
      continue;
    }
    if (char === ',') {
      pushField();
      index++;
      continue;
    }
    if (char === '\r' || char === '\n') {
      pushRow();
      if (char === '\r' && text[index + 1] === '\n') index++;
      index++;
      continue;
    }
    field += char;
    index++;
  }

  if (field.length > 0 || row.length > 0) pushRow();
  // A trailing newline is a terminator, not an empty record.
  while (rows.length > 1 && rows[rows.length - 1].every((cell) => cell === '')) rows.pop();
  return rows;
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map(csvField).join(','))
    .join('\r\n');
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
