# slugkit

Turn titles into URL slugs, from the command line or from code.

## Command line

```
$ slug "Hello, World!"
hello-world

$ slug "Crème brûlée à la carte"
creme-brulee-a-la-carte

$ slug --max 11 "hello world again"
hello-world
```

- Letters are lowercased.
- Accented letters become plain letters (é becomes e).
- Every run of characters that is not a letter or digit becomes one hyphen, and hyphens at the start and end are removed.
- `--max <n>` keeps the slug at most `n` characters long and cuts at a word boundary when it can. A single word longer than `n` is cut at `n`.
- Without text, `slug` prints `Usage: slug [--max <n>] <text>` to stderr and exits with code 1.
- `--max` with anything but a positive whole number prints `--max must be a positive whole number` to stderr and exits with code 1.

## Library

```js
import { slugify } from 'slugkit';

slugify('  Many   spaces  '); // 'many-spaces'
slugify('Hello wonderful world', { maxLength: 12 }); // 'hello'
```
