#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROADMAP = path.join(REPO_ROOT, ".claude-sync", "plans", "agent-orchestrator-roadmap.md");

const markdown = await readFile(ROADMAP, "utf8");
const matches = [...markdown.matchAll(/^- \[([ xX])\] (.+)$/gm)];
const total = matches.length;
const done = matches.filter((match) => match[1].toLowerCase() === "x").length;
const percent = total === 0 ? 0 : Math.round((done / total) * 100);

console.log(`progress=${percent}% (${done}/${total})`);

const next = matches.find((match) => match[1] === " ");
if (next) {
  console.log(`next=${next[2].trim()}`);
} else {
  console.log("next=none");
}
