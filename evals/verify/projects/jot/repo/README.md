# jot

A to-do list kept in a JSON file.

```
$ jot add buy milk
Added #1: buy milk
$ jot add walk the dog
Added #2: walk the dog
$ jot done 2
Done #2: walk the dog
$ jot list
[ ] 1. buy milk
[x] 2. walk the dog
```

- The list is saved to `todo.json` in the current folder. `--file <path>` uses another file.
- `add <text>` appends an open item and prints its number.
- `list` prints every item with its number, `[x]` for done and `[ ]` for open. An empty list prints `No todos.`
- `done <number>` marks that item done. A number with no item prints `No todo #<number>` to stderr and exits with code 1, and the file is not changed.
- Anything else prints the usage line to stderr and exits with code 1.
