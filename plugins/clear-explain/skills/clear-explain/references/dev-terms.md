# Developer terms

Grep this file for one term when you are unsure how to write it. Do not read it all. A term that is not here: write it in English and define it on first use.

## Notation

| Kind | How to write it | Examples |
|---|---|---|
| Names in code (functions, Hooks, props, methods, commands, keywords, headers) | Backticks, original case | `useEffect`, `Promise.all`, `git rebase`, `Cache-Control` |
| Named concepts, features, patterns | English, spelled as in the official documentation | Error Boundary, Suspense, state, closure |
| Abbreviations | Capitals, spelled out on first use | CORS (Cross-Origin Resource Sharing) |
| Basic terms | The reply language's usual word | function, component, error |

- Case follows the official documentation: react.dev for React, the web platform documentation and specifications for browser concepts, the TypeScript Handbook for TypeScript. React's own named features are capitalized (Effect, Hook, Suspense); general concepts are lowercase (state, props, closure), even at the start of a sentence.
- A basic word may follow an English concept name: cleanup function, fallback UI, preflight request. Keep one form per answer.
- Product names follow their official spelling: JavaScript, TypeScript, Node.js, React, Next.js, Vite, PostgreSQL (alias Postgres), MySQL, SQLite, Git.
- SQL keywords are code (`SELECT`, `LEFT JOIN`, `COUNT(*)`); the concepts are not (join, subquery, window function).

## Basic terms

Settled in every language; write them in the reply language: function, variable, constant, array, object, string, number, class, instance, method, parameter, argument, return value, loop, recursion, component, rendering, re-rendering, mount, unmount, event, event handler, callback, element, error, exception, synchronous, asynchronous, server, client, browser, request, response, header, status code, cookie, session, token, cache, library, framework, module, package, dependency, type, build, deploy, test, debugging, refactoring, bundle, log, commit, branch, repository, database, query, table, row, column, process, thread, memory, stack, queue, environment variable.

Design principles also go in the reply language, with the abbreviation on first use: dependency injection (DI), inversion of control (IoC), separation of concerns, single responsibility principle (SRP), coupling, cohesion, stateless.

## JavaScript and the runtime

| Term | One-line definition |
|---|---|
| closure | A function together with a reference to the variables around it when it was created |
| scope | The part of the code where a name can be used, decided by where the code is written |
| hoisting | The informal name for declarations behaving as if moved to the top of their scope |
| TDZ (temporal dead zone) | The span before a `let`, `const`, or `class` declaration where reading the name throws `ReferenceError` |
| execution context | The environment the engine creates to run code: variables, scope, and `this` |
| call stack | The record of the functions currently running and who called them |
| event loop | The loop that takes the next task from a queue when the call stack is empty |
| task, microtask | Queued work; after each task the engine runs every waiting microtask (`Promise` callbacks) |
| prototype chain | The links an object follows to find a property it does not have itself |
| pure function | A function that returns the same output for the same input and changes nothing outside |
| side effect | Any change a function makes outside its return value |
| shallow copy, deep copy | A copy that shares nested objects with the original, or one that copies them too |
| debounce | Run once after calls stop for a set time |
| throttle | Run at most once per set interval while calls continue |

## Browser and network

| Term | One-line definition |
|---|---|
| DOM | The browser's object tree for a document, and the API to change it |
| reflow (layout), repaint, paint | Recalculating sizes and positions, then drawing pixels |
| origin | The scheme, host, and port of a URL together |
| same-origin policy | The browser rule that blocks a page from reading responses from another origin |
| CORS | The way a server lists, in response headers, which other origins may read its responses |
| preflight request | The `OPTIONS` request a browser sends first to ask whether the real request is allowed |
| authentication, authorization | Checking who someone is; deciding what they may do |
| XSS | An attack that runs injected script in the victim's browser |
| CSRF | An attack that makes a logged-in browser send a request the user did not intend |
| idempotent | Sending the request many times has the same effect on the server as sending it once |

## React

| Term | One-line definition |
|---|---|
| state | A value a component remembers between renders; changing it schedules a new render |
| props | The inputs a parent passes to a child component |
| ref | A value a component keeps between renders without causing a render when it changes |
| Hook | A function starting with `use` that lets a component use React features |
| custom Hook | Your own function that calls Hooks to share logic (not state) between components |
| Effect | Code that runs after rendering to keep a component in step with something outside React |
| dependency array | The array passed to an Effect Hook; React compares its values to decide whether to run again |
| cleanup function | The function an Effect returns; React runs it before the next run and on unmount |
| context | A way to pass a value to a whole subtree without passing props |
| Suspense | A component that shows a fallback until its children are ready |
| Error Boundary | A component that catches errors its children throw during rendering and shows a fallback UI |
| Transition | A state update marked as non-urgent so urgent updates can go first |
| Strict Mode | A development-only mode that runs some code twice to expose impure rendering and missing cleanup |
| reconciliation | React comparing the new UI tree with the previous one to decide what to change |
| render phase, commit phase | React calling components to compute the UI; then applying the result to the DOM |
| hydration | Attaching event handlers and state to HTML that the server already rendered |
| Server Components | Components that render ahead of time, on the server, outside the client bundle |
| memoization | Reusing a result for the same inputs instead of computing it again |
| batching | Grouping several state updates into one render |

## TypeScript

| Term | One-line definition |
|---|---|
| type narrowing | The compiler using a runtime check (`typeof`, `instanceof`) to treat a value as a more specific type |
| type guard | A check, or a function returning `x is T`, that narrows a type |
| type assertion | `as T`: telling the compiler to treat a value as `T`, with no runtime check |
| union type, intersection type | `A \| B`: a value of either type; `A & B`: a value of both |
| generic | A type parameter that a function or type fills in at the place it is used |
| structural typing | Type compatibility decided by shape, not by name |

## Databases

| Term | One-line definition |
|---|---|
| transaction | A group of statements that the database applies all together or not at all |
| isolation level | How much one transaction can see of others that run at the same time |
| lock, deadlock | A claim on data that makes others wait; two transactions waiting for each other forever |
| index | A sorted structure of column values with row locations, used to find rows without reading them all |
| primary key, foreign key | The column set that identifies a row; a column that refers to another table's key |
| normalization, denormalization | Splitting tables so each fact is stored once; copying data back to make reads cheaper |
| join | Combining rows of two tables by a condition |
| execution plan | The steps the database chooses to run a query |
| replication, sharding | Copying data to other servers; splitting data across servers |

## Git

| Term | One-line definition |
|---|---|
| working tree, index (staging area) | Your files on disk; the set of changes chosen for the next commit |
| remote-tracking branch | A read-only copy of a remote branch in your repository, such as `origin/main` |
| merge, rebase | Joining two histories with a merge commit; replaying your commits on top of another base |
| fast-forward | Moving a branch pointer ahead when no merge commit is needed |

## Abbreviations

Spell out on first use: API (application programming interface), CORS (Cross-Origin Resource Sharing), CSR (client-side rendering), DOM (Document Object Model), ESM (ECMAScript modules), HTTP (Hypertext Transfer Protocol), JSON (JavaScript Object Notation), JWT (JSON Web Token), SSR (server-side rendering), SSG (static site generation), TDZ (temporal dead zone), XSS (cross-site scripting), CSRF (cross-site request forgery).
