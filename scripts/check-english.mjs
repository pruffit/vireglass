#!/usr/bin/env node
// Every tracked text file is English. The package started life inside a Russian-speaking
// monorepo, and comments kept arriving in Russian after it was opened up.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Cyrillic and Cyrillic Supplement, compared as code points so this file stays ASCII itself.
const isCyrillic = (line) => [...line].some((ch) => {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x0400 && code <= 0x052f;
});

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const hits = [];
for (const file of files) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  bytes
    .toString('utf8')
    .split('\n')
    .forEach((line, i) => {
      if (isCyrillic(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
}

if (hits.length) {
  console.error(`check-english: ${hits.length} line(s) are not in English:\n${hits.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`check-english: ${files.length} tracked files, all English`);
}
