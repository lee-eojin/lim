# Confusable terms

Read this when an explanation uses two or more similar terms, or one word that covers several meanings. Spelling follows `dev-terms.md`. Each distinction follows the primary documentation of the technology (specifications, RFCs, and official docs).

How to use it:
- When two terms appear together, put them side by side in a table. Do not repeat a contrast sentence in every paragraph.
- When one word covers several meanings, fix the meaning with the English term on first use.
- Do not explain with a retired name (section 2). When quoting old material, give the new name too.

## 1. One word, several meanings

| Word | Meanings | How to write |
|---|---|---|
| render | React render, React commit, browser paint, server HTML (SSR) | name the phase |
| context | execution context, `this`, React context, scope | name which |
| session | server session, `sessionStorage` page session, session cookie, analytics session | say whose session |
| cache | HTTP cache, memoization, a data-fetching library's cache | say which layer |
| commit | database transaction commit, Git commit, React commit phase | say which |
| index | database index, array index, Git index (staging area) | say which |
| key | database key, JavaScript object key, React `key` | say which |
| schema | database schema (differs by product), JSON Schema, GraphQL schema | say which |
| partition | table partitioning, network partition (CAP), `PARTITION BY` | write the English term |
| consistency | ACID consistency (constraints hold), CAP consistency (every node has the latest value), eventual consistency | write the English term |
| normalization | database normalization, Unicode normalization, scaling numbers to a range | say what is normalized |
| async | asynchronous, non-blocking, a React state update that is not visible yet | for React, explain snapshots and batching |
| API | a browser Web API, a backend HTTP API | say which |
| deprecated | still works but not recommended; may be removed later | do not write removed |

## 2. Renamed or retired terms

- Server Actions -> Server Functions (React). A Server Function used as a form `action` is still called a Server Action.
- FID -> INP as the Core Web Vitals responsiveness metric (March 2024).
- `git checkout` for switching -> `git switch`; for restoring files -> `git restore`.
- `__proto__` -> `Object.getPrototypeOf()` and `Object.setPrototypeOf()`.
- master and slave for replicas -> primary and replica.

## 3. JavaScript

| Terms | Distinction |
|---|---|
| parameter / argument | A parameter is the name in the function definition. An argument is the value passed in a call |
| `null` / `undefined` | `undefined` is the value of something never assigned. `null` is an intentional "no object" |
| `==` / `===` / `Object.is` | `==` converts types before comparing; `===` does not. `Object.is` also tells `NaN` and `+0`/`-0` apart. React compares dependencies with `Object.is` |
| shallow copy / deep copy | Spread, `Object.assign`, and `slice` make shallow copies; nested objects stay shared. `structuredClone` makes a deep copy |
| `const` / immutable | `const` blocks reassignment only. The object can still change. `Object.freeze` freezes one level |
| closure / inner function | A closure is about keeping a reference to outer variables, not about a function inside a function. Every function in JavaScript forms a closure |
| hoisting / TDZ | Declarations act as if moved up. `let`, `const`, and `class` throw `ReferenceError` if read before the declaration runs |
| task / microtask | Timers and events queue tasks; `Promise` callbacks queue microtasks. After each task, all microtasks run. "macrotask" is not a specification term |
| `for...in` / `for...of` | `for...in` walks an object's enumerable string keys. `for...of` walks the values an iterable yields |
| expression / statement | An expression produces a value; a statement does an action. JSX braces accept only expressions |
| callback / asynchronous | A callback is a function passed to be called later; it can be called synchronously (`Array.prototype.map`) |
| pass by reference / pass by sharing | JavaScript passes values. For an object, the value is a reference: changing a property shows outside, reassigning the parameter does not |

## 4. Browser and rendering

| Terms | Distinction |
|---|---|
| render / commit / paint | React render computes the UI. Commit applies it to the DOM. The browser then paints pixels |
| reflow / repaint / composite | Reflow recalculates layout; repaint draws again; composite combines layers. `transform` and `opacity` changes can skip to composite |
| DOM / virtual DOM / shadow DOM | The DOM is the browser's document tree. Virtual DOM is a library-level in-memory copy. Shadow DOM is encapsulated markup in Web Components |
| attribute / property | An attribute is in the HTML markup. A property is on the DOM object. An input's `value` attribute is the initial value; the property is the current value |
| `event.target` / `event.currentTarget` | `target` is where the event happened. `currentTarget` is the element whose listener is running |
| `preventDefault` / `stopPropagation` | The first stops the default action (following a link). The second stops the event from moving to other elements |
| `defer` / `async` script | Both download in parallel with parsing. `async` runs on arrival; `defer` runs after parsing, in document order |
| `localStorage` / `sessionStorage` / cookie | `localStorage` lasts per origin. `sessionStorage` lasts per tab. A cookie is sent to the server with requests |
| web worker / service worker | A web worker runs computation off the main thread. A service worker sits between the page and the network and can intercept requests |
| debounce / throttle | Debounce runs once after calls stop. Throttle runs at most once per interval while calls continue |
| origin / site | Same origin needs the same scheme, host, and port. Same site compares the registrable domain. CORS uses origin; `SameSite` cookies use site |

## 5. HTTP and security

| Terms | Distinction |
|---|---|
| authentication / authorization | Who you are, versus what you may do. The `Authorization` header carries authentication credentials despite its name |
| 401 / 403 | 401: no valid credentials. 403: the server understood and refuses, even when authenticated |
| safe / idempotent | Safe methods change nothing (`GET`, `HEAD`). Idempotent means repeating has the same effect as once: `PUT` and `DELETE` are idempotent but not safe |
| `PUT` / `PATCH` | `PUT` replaces the whole resource. `PATCH` sends instructions for a partial change |
| cookie / session / token | A cookie is a storage and transport mechanism. A session is server-side memory of the user. A token is a string with credentials or claims; it can travel in a cookie |
| same-origin policy / CORS | The browser's same-origin policy blocks reading other origins. CORS is how a server relaxes that. A CORS error is fixed on the server or with a dev-server proxy |
| CORS / CSRF | CORS controls reading responses. CSRF is an attack that sends requests. CORS settings do not prevent CSRF |
| encoding / encryption / hashing | Encoding changes format and reverses without a key. Encryption reverses only with a key. Hashing does not reverse |
| `no-cache` / `no-store` | `no-cache` stores but revalidates before reuse. `no-store` does not store |
| latency / bandwidth / throughput | Time to arrive; maximum capacity; what actually moved |

## 6. React

| Terms | Distinction |
|---|---|
| props / state | Props are inputs from the parent. State is what the component remembers and changes |
| state / ref | Changing state renders again, and each render sees a fixed snapshot. Changing `ref.current` does not render |
| `useEffect` / `useLayoutEffect` | `useLayoutEffect` runs before the browser paints, for measuring layout. `useEffect` usually runs after paint |
| `useMemo` / `useCallback` / `memo` | `useMemo` caches a computed value. `useCallback` caches a function. `memo` skips re-rendering a component when its props are the same |
| re-render / remount | A re-render keeps state. A change of position, type, or `key` remounts and resets state |
| SSR / hydration | SSR builds HTML on the server. Hydration makes that HTML interactive in the browser |
| Server Components / SSR | Different axes. Server Components are a kind of component. SSR is a way to produce HTML; Client Components are server-rendered too |
| event handler / Effect | An event handler runs because of an interaction. An Effect runs because rendering made synchronization necessary |
| "setState is async" / snapshot and batching | The setter returns no `Promise`. State is a per-render snapshot, and React batches updates after the handler finishes |
| context / state management | Context passes a value down. `useState` or `useReducer` holds and changes it |
| Error Boundary / `try`/`catch` | An Error Boundary catches rendering errors below it, not errors in event handlers, async code, or itself |
| custom Hook / shared state | A custom Hook shares logic. Two components using it each get their own state |

## 7. TypeScript

| Terms | Distinction |
|---|---|
| `any` / `unknown` / `never` | `any` turns checking off. `unknown` accepts anything but needs narrowing before use. `never` has no values |
| `interface` / `type` | Mostly interchangeable. An `interface` can be reopened to add members (declaration merging); a `type` cannot |
| type assertion / conversion / narrowing | `as` changes nothing at runtime. `Number(x)` converts at runtime. Narrowing follows a runtime check |
| annotation / assertion / `satisfies` | `: T` declares the type. `as T` overrides the check. `satisfies T` checks against `T` and keeps the inferred type |
| type checking / transpiling | Many build tools strip types without checking them. `tsc` or the editor reports type errors |
| `prop?: T` / `prop: T \| undefined` | `?` lets the property be missing. `\| undefined` requires the property, which may hold `undefined` |

## 8. Testing

| Terms | Distinction |
|---|---|
| test double kinds | A dummy fills a slot. A fake is a simple working implementation. A stub returns set answers. A spy records calls. A mock checks expected calls |
| unit / integration / end-to-end | Teams define these differently; say which definition you use. End-to-end drives the real app like a user |
| coverage / test quality | Coverage shows which code ran. It finds untested code; it does not measure how good the tests are |

## 9. Build and packages

| Terms | Distinction |
|---|---|
| library / framework | Your code calls a library. A framework calls your code (inversion of control) |
| compile / transpile / bundle | Compile changes code into another form. Transpile is source to source. Bundle joins modules by their imports |
| polyfill / transpile | A polyfill adds a missing API. Transpiling rewrites new syntax. Syntax cannot be polyfilled |
| tree shaking / code splitting | Tree shaking drops unused code. Code splitting loads code in chunks when needed |
| minification / compression | Minification removes whitespace and shortens names at build time. Compression (gzip, br) happens in transfer |
| ESM / CommonJS | `import`/`export` is the standard. `require`/`module.exports` is the older Node.js format |
| `^` / `~` / lockfile | `^1.2.3` allows minor and patch updates; `~1.2.3` allows patch only. The lockfile records exactly what was installed |
| build-time variable / secret | Values read at build time are written into the bundle. A secret in a frontend variable is public |

## 10. Git

| Terms | Distinction |
|---|---|
| merge / rebase | Merge joins histories and keeps existing commits. Rebase rewrites your commits onto a new base. Do not rebase commits others already have |
| `fetch` / `pull` | `fetch` updates remote-tracking branches only. `pull` fetches and then merges or rebases |
| `reset` / `restore` / `revert` | `revert` adds a commit that undoes one. `restore` changes files. `reset` moves the branch and rewrites history |
| fast-forward / merge commit / squash merge | Move the pointer; add a commit with two parents; fold many commits into one |
| `origin` / `upstream` | `origin` is the default remote of a clone. `upstream` is the conventional name for the original repository of a fork, and also a branch's tracked remote branch |

## 11. Databases

| Terms | Distinction |
|---|---|
| `WHERE` / `HAVING` | `WHERE` filters rows before grouping. `HAVING` filters groups after |
| inner join / outer join | An inner join keeps matching rows. A left outer join also keeps every left row, with `NULL` where nothing matches |
| clustered / secondary index | A clustered index stores the rows in key order. A secondary index stores keys with a pointer to the row |
| optimistic / pessimistic locking | Optimistic checks for conflicts at write time. Pessimistic locks before reading |
| dirty read / non-repeatable read / phantom read | Reading uncommitted data; reading a row twice with different values; a repeated query returning new rows |
| replication / sharding / partitioning | Copies on other servers; data split across servers; a table split inside one database |

## 12. General

| Terms | Distinction |
|---|---|
| concurrency / parallelism | Concurrency interleaves tasks. Parallelism runs them at the same time. The event loop gives concurrency; web workers give parallelism |
| synchronous / blocking | Blocking is about whether the caller waits. Synchronous is about whether the result arrives with the call. No single official definition exists; say which axis you mean |
| process / thread | A process is a running program with its own memory. A thread runs part of a process |
| refactoring / behavior change | Refactoring keeps observable behavior. A change in behavior is a feature or a fix |
