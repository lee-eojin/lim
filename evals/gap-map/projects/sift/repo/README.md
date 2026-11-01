# sift

`node sift.js query.sift` reads a query line and JSON lines, and prints the lines that match.

## Queries

- `field = value` keeps the lines whose field equals the value.
- `field != value` keeps the lines whose field differs from the value.
- A line without the field never matches.

## Planned

- `or` between two conditions.

Tests live in `tests/`; each ends in the `#|` lines its run must print.
