export function addTodo(todos, text) {
  return [...todos, { text, done: false }];
}

export function completeTodo(todos, number) {
  const index = number - 1;
  if (!Number.isInteger(number) || !todos[index]) throw new Error(`No todo #${number}`);
  return todos.map((todo, position) => (position === index ? { ...todo, done: true } : todo));
}

export function formatList(todos) {
  if (!todos.length) return 'No todos.';
  return todos.map((todo, position) => `[${todo.done ? 'x' : ' '}] ${position + 1}. ${todo.text}`).join('\n');
}
