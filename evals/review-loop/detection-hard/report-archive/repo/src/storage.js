export async function uploadArchive(bucket, key, body) {
  await bucket.put(key, body, { contentType: 'application/x-ndjson' });
  return key;
}
