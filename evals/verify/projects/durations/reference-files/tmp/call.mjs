import * as library from '../src/index.js';

const [name, ...args] = process.argv.slice(2);
const result = library[name](...args.map((arg) => (/^-?\d+$/.test(arg) ? Number(arg) : arg)));
console.log(typeof result === 'string' ? result : JSON.stringify(result));
