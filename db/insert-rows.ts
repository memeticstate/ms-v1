/** D1 permits 100 bound values per statement. Keep every value parameterized. */
export function prepareInsertRows(db: D1Database, table: string, columns: string[], rows: Array<Array<string | number | null>>) {
  if (![table, ...columns].every(value => /^[a-z_][a-z0-9_]*$/.test(value)) || !columns.length || columns.length > 100) throw new Error("invalid_insert_shape");
  if (rows.some(row => row.length !== columns.length)) throw new Error("invalid_insert_row");
  const size = Math.floor(100 / columns.length);
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    const batch = rows.slice(offset, offset + size);
    const placeholders = batch.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    statements.push(db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`).bind(...batch.flat()));
  }
  return statements;
}
