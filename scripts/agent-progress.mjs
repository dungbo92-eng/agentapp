#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROADMAP = path.join(REPO_ROOT, ".claude-sync", "plans", "agent-orchestrator-roadmap.md");

const markdown = await readFile(ROADMAP, "utf8");
const lines = markdown.split(/\r?\n/);
const phases = [];
let currentPhase = null;

for (const line of lines) {
  const phaseMatch = line.match(/^##\s+(.+)$/);
  if (phaseMatch) {
    currentPhase = {
      name: phaseMatch[1].trim(),
      tasks: []
    };
    phases.push(currentPhase);
    continue;
  }

  const taskMatch = line.match(/^- \[([ xX])\]\s+(.+)$/);
  if (!taskMatch) continue;

  const task = {
    done: taskMatch[1].toLowerCase() === "x",
    title: taskMatch[2].trim()
  };

  if (!currentPhase) {
    currentPhase = {
      name: "Uncategorized",
      tasks: []
    };
    phases.push(currentPhase);
  }

  currentPhase.tasks.push(task);
}

const matches = phases.flatMap((phase) => phase.tasks);
const total = matches.length;
const done = matches.filter((task) => task.done).length;
const percent = total === 0 ? 0 : Math.round((done / total) * 100);

console.log(`progress=${percent}% (${done}/${total})`);

for (const phase of phases.filter((item) => item.tasks.length > 0)) {
  const phaseTotal = phase.tasks.length;
  const phaseDone = phase.tasks.filter((task) => task.done).length;
  const phasePercent = phaseTotal === 0 ? 0 : Math.round((phaseDone / phaseTotal) * 100);
  console.log(`phase="${phase.name}" progress=${phasePercent}% (${phaseDone}/${phaseTotal})`);
}

const next = matches.find((task) => !task.done);
if (next) {
  console.log(`next=${next.title}`);
} else {
  console.log("next=none");
}
