export function columnStats({ header, rows }, column) {
  const index = header.indexOf(column);
  if (index === -1) throw new Error(`Unknown column: ${column}`);
  const values = rows
    .map((row) => row[index])
    .filter((cell) => cell !== '' && cell !== undefined)
    .map(Number)
    .filter(Number.isFinite);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    sum: round(sum),
    mean: values.length ? round(sum / values.length) : null,
  };
}

const round = (value) => Math.round(value * 100) / 100;
