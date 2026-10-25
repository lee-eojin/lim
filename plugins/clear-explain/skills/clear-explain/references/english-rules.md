# English rules

Read this when the explanation, or part of it, is in English. The base is the U.S. federal Plain Language guidelines and common practice in developer documentation style guides. From ASD-STE100 only the principles are taken; its dictionary is copyrighted and is not reproduced. The patterns that `scripts/check-clarity.mjs` matches are in `data/vague-words-en.txt`.

## 1. Principles from STE

| Principle | Example |
|---|---|
| One word for one concept. Do not switch to a synonym for variety | Pick start; do not mix start, begin, and initiate |
| Procedure sentences up to 20 words, descriptive sentences up to 25 | Over the limit, split into two sentences |
| One instruction per sentence; steps in the imperative | Install the package. Then restart the server. |
| Condition first | If the build fails, delete `node_modules`. |
| At most three nouns in a row | user session token refresh logic -> the logic that refreshes the session token |
| Active voice; passive only when the actor is unknown | The config is loaded -> Vite loads the config |
| Actions as verbs | perform an update of the cache -> update the cache |
| A one-word verb over a phrasal verb (set up, log in, and sign in are fine) | find out -> learn, carry out -> do |
| Keep the articles | Click button -> Click the button |

## 2. Conjunctions with two meanings

| Avoid | Write | Why |
|---|---|---|
| since (reason) | because | since also reads as time |
| as (reason) | because | as also reads as time or manner |
| once (after) | after, when | once also reads as "one time" |
| while (contrast) | although, whereas | keep while for "at the same time" |
| whether or not | whether | for a condition write if; for uncertainty, whether; for a point in time, when |

## 3. Modal verbs

| Word | Meaning to use | Avoid |
|---|---|---|
| must | required | for something optional |
| should | recommended but optional | as a guess ("this should work") -> might, will |
| may | do not use; it mixes permission and possibility | ability: can; possibility: might |
| might | possibility | |
| can | ability | if you can state the action directly, drop can |
| will | plain future | present tense is simpler for explanations |
| shall | do not use | must |
| could, would | hypothetical only | otherwise can |

When explaining a specification: RFC 2119 and RFC 8174 keywords (MUST, SHOULD, MAY) are keywords only in capitals. Say which one you mean.

## 4. Words that judge difficulty, and filler

| Avoid | Why and what to do |
|---|---|
| simply, simple, just, easy, easily, quick, quickly | easy for the writer is not easy for the reader; remove if the meaning stays |
| obviously, clearly, of course | a reader who did not know feels slow |
| basically, actually, really, very, quite | usually removable |
| note that, at this time, at this point in time | filler; remove, or write now |
| in order to | to |

## 5. Abbreviations and symbols

| Avoid | Write |
|---|---|
| etc., and so on | every item, or "such as" with one or two examples |
| and/or | or; if both are possible, "A, B, or both" |
| e.g. | for example, such as |
| i.e. | that is |
| via | through, by, using |
| vs. (in running text) | versus |
| a slash between words | and, or |

## 6. Rough verbs in developer text

| Avoid | Write | Exception |
|---|---|---|
| abort | cancel (request), stop (process), close (app), end (connection) | API names such as `AbortController` |
| kill | stop, end | explaining the `kill` command |
| hit (a key) | press, select | |
| hit (a server or API) | call, send a request to | |
| execute | run (a script, query, or function) | |
| leverage, utilize | use | |
| impact (verb) | affect | |
| issue (meaning problem) | problem, bug, error | a named issue in a tracker |

## 7. Plain substitutes

A selection from the Plain Language word list that shows up in developer explanations. The list is in the public domain.

| Instead of | Write |
|---|---|
| accomplish, perform | do |
| additional | more, other |
| approximately | about |
| assist, facilitate | help |
| attempt | try |
| commence, initiate | start |
| consequently, therefore | so |
| demonstrate, indicate | show |
| determine | decide, find |
| due to the fact that | because |
| eliminate | remove |
| ensure | make sure |
| in the event of | if |
| modify | change |
| numerous | many |
| obtain | get |
| prior to | before |
| provide | give |
| require | need |
| retain | keep |
| subsequently | then, after |
| sufficient | enough |
| terminate | end, stop |
| there is, there are | rewrite with the real subject |
| utilize | use |

Do not replace a word used as a technical term: parameter, component, implement (an interface), and request (HTTP) stay.

## 8. Where the sources disagree

| Topic | This skill's choice | Why |
|---|---|---|
| Contractions (don't, isn't) | Use them | Plain Language and developer style guides recommend them; a contracted negative is harder to miss. STE forbids them |
| run or operate | run | Developer documentation practice. STE uses operate |
| enough or sufficient | enough | Plain Language |
| check (verb) | a more exact verb when there is one (verify, inspect, make sure) | STE allows check only as a noun |
| Condition position | Before the action | STE and developer style guides. Plain Language puts long conditions last |

## 9. Over-correction

These rules are choices for clarity, not grammar. When you point at a user's text, say "this is clearer", not "this is wrong". A passive verb, a long sentence that is still clear, or a vague word that nobody has to act on can stay.
