# slug

`slugify(title)` turns a title into a URL slug: lowercase letters and digits joined by single hyphens, with no hyphen at either end.

```js
import { slugify } from 'slug';

slugify('Hello, World!'); // 'hello-world'
```
