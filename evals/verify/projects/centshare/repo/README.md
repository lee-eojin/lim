# centshare

Split money into parts that add up to the cent, and read and write amounts as whole cents. Standard library only, Python 3.9 or later.

```python
from centshare import allocate, from_cents, to_cents

to_cents("12.34")      # 1234
to_cents("1,234.5")    # 123450
to_cents("-0.75")      # -75
to_cents("12.345")     # raises ValueError: Not an amount: '12.345'

from_cents(123450)     # '1,234.50'
from_cents(-5)         # '-0.05'

allocate("10.00", 3)   # ['3.34', '3.33', '3.33']
allocate("0.05", 4)    # ['0.02', '0.01', '0.01', '0.01']
allocate("10.00", 0)   # raises ValueError: parts must be an int of 1 or more
allocate("-1.00", 2)   # raises ValueError: Cannot allocate a negative amount: '-1.00'
```

## to_cents(text)

Returns the amount as a whole number of cents. An amount is digits with an optional leading `-`, optional commas between groups of three digits, and at most two decimals. Anything else raises `ValueError: Not an amount: '<text>'`.

## from_cents(cents)

Returns the amount with two decimals and commas between groups of three digits.

## allocate(amount, parts)

Splits an amount, given as text like `to_cents` reads, into `parts` amounts that add up exactly to it. The parts differ by at most one cent: when the amount does not divide evenly, the leftover cents go to the first parts, one each. `parts` that is not an int of 1 or more raises `ValueError: parts must be an int of 1 or more`, and a negative amount raises `ValueError: Cannot allocate a negative amount: '<amount>'`.
