# courier

A small HTTP client wrapper used by the export jobs.

- Requests time out after 30 seconds by default.
- Failed requests are retried when `should_retry` says so.
- `jobs/nightly.py` exports the day's records; the scheduler runs it every night.
