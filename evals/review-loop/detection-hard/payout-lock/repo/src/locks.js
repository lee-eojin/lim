const held = new Map();

export async function acquire(key) {
  while (held.has(key)) {
    await held.get(key).promise;
  }
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  held.set(key, { promise });
  return function release() {
    held.delete(key);
    resolve();
  };
}
