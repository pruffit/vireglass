#!/usr/bin/env node
// Every tracked text file is English. The package started life inside a Russian-speaking
// monorepo, and comments kept arriving in Russian after it was opened up.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CYRILLIC = /[Ѐ-ӿ]/;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const hits = [];
for (const file of files) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  bytes
    .toString('utf8')
    .split('\n')
    .forEach((line, i) => {
      if (CYRILLIC.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
}

if (hits.length) {
  console.error(`check-english: ${hits.length} line(s) are not in English:\n${hits.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`check-english: ${files.length} tracked files, all English`);
}
