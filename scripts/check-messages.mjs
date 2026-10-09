#!/usr/bin/env node
/**
 * Fails when the message catalogues disagree: every key in one must be in
 * the other, with the same placeholders ({name}, plurals), so a missing
 * translation stops the build instead of showing a raw key to a user.
 * Runs before `next build` and in `npm run lint`.
 */
import { readFileSync } from "node:fs";

const FILES = ["messages/en-GB.json", "messages/de-DE.json"];

/** Every leaf, as "a.b.c" -> the message. */
function leaves(value, prefix = "", out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object") leaves(child, path, out);
    else out.set(path, String(child));
  }
  return out;
}

/** The argument names a message uses: {name}, {count, plural, ...}. */
function placeholders(message) {
  return [...message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)]
    .map((m) => m[1])
    .sort()
    .join(",");
}

const [reference, ...others] = FILES.map((file) => ({
  file,
  messages: leaves(JSON.parse(readFileSync(file, "utf8"))),
}));
const problems = [];
for (const other of others) {
  for (const [key, message] of reference.messages) {
    if (!other.messages.has(key)) problems.push(`${other.file}: missing "${key}"`);
    else if (placeholders(other.messages.get(key)) !== placeholders(message)) {
      problems.push(`${other.file}: "${key}" uses different placeholders than ${reference.file}`);
    }
  }
  for (const key of other.messages.keys()) {
    if (!reference.messages.has(key))
      problems.push(`${other.file}: "${key}" is not in ${reference.file}`);
  }
  for (const [key, message] of other.messages) {
    if (!message.trim()) problems.push(`${other.file}: "${key}" is empty`);
  }
}

if (problems.length > 0) {
  console.error(`Message catalogues disagree:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Message catalogues agree (${reference.messages.size} messages).`);
