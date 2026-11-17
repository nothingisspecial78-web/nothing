export function downloadCSV(filename: string, rows: Array<Array<string | number | boolean | null | undefined>>): void {
  const escape = (cell: string | number | boolean | null | undefined): string => {
    const str = cell === null || cell === undefined ? "" : String(cell);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = rows.map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
