#!/usr/bin/env node
import { load, save } from '../src/store.js';
import { addTodo, completeTodo, formatList } from '../src/todos.js';

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const file = fileIndex === -1 ? 'todo.json' : args.splice(fileIndex, 2)[1];
const [command, ...rest] = args;
const todos = load(file);

if (command === 'add' && rest.length) {
  const text = rest.join(' ');
  const next = addTodo(todos, text);
  save(file, next);
  console.log(`Added #${next.length}: ${text}`);
} else if (command === 'list') {
  console.log(formatList(todos));
} else if (command === 'done' && rest.length === 1) {
  const number = Number(rest[0]);
  try {
    const next = completeTodo(todos, number);
    save(file, next);
    console.log(`Done #${number}: ${todos[number - 1].text}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  console.error('Usage: jot [--file <path>] add <text> | list | done <number>');
  process.exit(1);
}
