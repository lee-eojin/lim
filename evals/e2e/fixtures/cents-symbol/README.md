# cents

Formats an amount in cents as dollars.

## Usage

```
$ cents 1999
$19.99
$ cents 5
$0.05
```

The amount is always shown with two decimal places.

`--symbol <text>` replaces the dollar sign, for example `cents 250 --symbol EUR` prints `EUR2.50`.

A missing or non-numeric amount prints `cents: amount must be a whole number of cents` to stderr and exits with code 2.
