# tally

Count, sum, and average one column of a CSV file.

```
$ tally examples/sales.csv --column amount
count: 3
sum: 60
mean: 20

$ tally examples/sales.csv --column units --format json
{"count":4,"sum":10,"mean":2.5}
```

- The first line of the file is the header. Blank lines are ignored.
- Cells that are empty or not numbers, such as `n/a`, are skipped: they do not count toward `count`, `sum`, or `mean`.
- `sum` and `mean` are rounded to two decimals. With no numeric cells, `mean` is `-` in text and `null` in JSON.
- A column the header does not have prints `Unknown column: <name>` to stderr and exits with code 2.
- A file that cannot be read prints `Cannot read <file>` to stderr and exits with code 2.
- Missing arguments print the usage line to stderr and exit with code 1.
