export const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfDay = (time) => time - (time % DAY_MS);
export const endOfDay = (time) => startOfDay(time) + DAY_MS - 1;
export const addDays = (time, days) => time + days * DAY_MS;
export const isoDate = (time) => new Date(time).toISOString().slice(0, 10);
