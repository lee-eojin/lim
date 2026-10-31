#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function tokens(text) {
  return text.match(/\d+|\*\*|[A-Za-z_]\w*|[-+*\/()=]/g) ?? [];
}

function parse(list) {
  let at = 0;
  const peek = () => list[at];
  const take = () => list[at++];
  const atom = () => {
    const token = take();
    if (token === '(') {
      const inner = sum();
      take();
      return inner;
    }
    if (/^\d+$/.test(token)) return { num: BigInt(token) };
    return { name: token };
  };
  const power = () => {
    let left = atom();
    while (peek() === '**') {
      take();
      left = { op: '**', left, right: atom() };
    }
    return left;
  };
  const product = () => {
    let left = power();
    while (peek() === '*' || peek() === '/') left = { op: take(), left, right: power() };
    return left;
  };
  const sum = () => {
    let left = product();
    while (peek() === '+' || peek() === '-') left = { op: take(), left, right: product() };
    return left;
  };
  return sum();
}

function evaluate(node, scope) {
  if (node.num !== undefined) return node.num;
  if (node.name !== undefined) {
    if (!scope.has(node.name)) throw new Error(`${node.name} is not bound`);
    return scope.get(node.name);
  }
  const left = evaluate(node.left, scope);
  const right = evaluate(node.right, scope);
  if (node.op === '+') return left + right;
  if (node.op === '-') return left - right;
  if (node.op === '*') return left * right;
  if (node.op === '**') return left ** right;
  if (right === 0n) throw new Error('division by zero');
  return left / right;
}

const scope = new Map();
try {
  for (const raw of readFileSync(process.argv[2], 'utf8').split('\n')) {
    const line = raw.replace(/--.*$/, '').replace(/#\|.*$/, '').trim();
    if (!line) continue;
    const binding = /^let\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(line);
    if (binding) {
      if (scope.has(binding[1])) throw new Error(`${binding[1]} is already bound`);
      scope.set(binding[1], evaluate(parse(tokens(binding[2])), scope));
    } else if (line.startsWith('print ')) {
      console.log(String(evaluate(parse(tokens(line.slice(6))), scope)));
    } else {
      throw new Error(`cannot read: ${line}`);
    }
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
