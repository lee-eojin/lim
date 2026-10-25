export function parseCsv(text) {
  const [header, ...rows] = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(',').map((cell) => cell.trim()));
  return { header: header ?? [], rows };
}
