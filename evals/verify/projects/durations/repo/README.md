# durations

Parse and format durations such as `1h30m`. No dependencies.

```js
import { parseDuration, formatDuration } from 'durations';

parseDuration('1h30m'); // 5400000
parseDuration('2d'); // 172800000
parseDuration('1m 30s 500ms'); // 90500
parseDuration('soon'); // throws Error: Invalid duration: "soon"

formatDuration(5400000); // '1h 30m'
formatDuration(90061000); // '1d 1h 1m 1s'
formatDuration(1500); // '1s 500ms'
formatDuration(0); // '0s'
formatDuration(-5); // throws Error: formatDuration needs a whole number of milliseconds, 0 or more
```

## parseDuration(text)

Returns milliseconds. Units are `d`, `h`, `m`, `s`, and `ms`, in any combination, with or without spaces between parts. Anything else throws `Invalid duration: "<text>"`.

## formatDuration(milliseconds)

Returns the largest units first and leaves out units that are zero. `0` is `0s`. A negative number or a fraction throws.
