const UNITS = ['B', 'KiB', 'MiB', 'GiB'];

export function formatSize(bytes) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(2)} ${UNITS[unit]}`;
}
