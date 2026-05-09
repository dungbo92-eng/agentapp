#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = path.join(REPO_ROOT, "tools", "agent-orchestrator", "usage-budget.example.json");
const DAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};
const INDEX_DAY = Object.fromEntries(Object.entries(DAY_INDEX).map(([day, index]) => [index, day]));

function parseArgs(argv) {
  const options = {
    config: DEFAULT_CONFIG,
    date: "",
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;

    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (key in options) options[key] = value || "";
  }

  return options;
}

function usage() {
  console.error("usage: pnpm agent:budget -- [--date YYYY-MM-DD] [--json]");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function parseDate(value) {
  if (!value) return new Date();
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid date: ${value}`);
  }
  return parsed;
}

function dayName(date) {
  return INDEX_DAY[date.getDay()];
}

function daysUntil(fromIndex, targetIndex) {
  const diff = (targetIndex - fromIndex + 7) % 7;
  return diff === 0 ? 7 : diff;
}

function daysInWindow(todayIndex, count) {
  return Array.from({ length: count }, (_, offset) => INDEX_DAY[(todayIndex + offset) % 7]);
}

function totalRemaining(config) {
  return (config.accounts || []).reduce((sum, account) => sum + Number(account.remaining_units || 0), 0);
}

function providerSummary(config) {
  const summaries = new Map();
  for (const account of config.accounts || []) {
    const current = summaries.get(account.provider) || {
      provider: account.provider,
      accounts: 0,
      remaining_units: 0,
      weekly_budget_units: 0
    };
    current.accounts += 1;
    current.remaining_units += Number(account.remaining_units || 0);
    current.weekly_budget_units += Number(account.weekly_budget_units || 0);
    summaries.set(account.provider, current);
  }
  return Array.from(summaries.values());
}

function calculateBudget(config, options) {
  const date = parseDate(options.date);
  const today = dayName(date);
  const todayIndex = DAY_INDEX[today];
  const resetIndex = DAY_INDEX[config.week_start_day || "monday"];
  const daysToReset = daysUntil(todayIndex, resetIndex);
  const periodDays = daysInWindow(todayIndex, daysToReset);
  const reserveDays = new Set(config.weekend_reserve?.days || []);
  const weekendDaysLeft = periodDays.filter((day) => reserveDays.has(day));
  const workingDaysLeft = Math.max(1, periodDays.length - weekendDaysLeft.length);
  const available = totalRemaining(config);
  const reserve = config.weekend_reserve?.enabled ? Number(config.weekend_reserve.minimum_units || 0) : 0;
  const spendableBeforeReserve = Math.max(0, available - reserve);
  const todayBudget = spendableBeforeReserve / workingDaysLeft;

  return {
    date: date.toISOString().slice(0, 10),
    timezone: config.timezone,
    today,
    reset_day: config.week_start_day,
    days_to_reset: daysToReset,
    days_in_window: periodDays,
    weekend_reserve: {
      enabled: Boolean(config.weekend_reserve?.enabled),
      days: Array.from(reserveDays),
      days_left: weekendDaysLeft,
      minimum_units: reserve
    },
    budget: {
      total_remaining_units: available,
      spendable_before_reserve: spendableBeforeReserve,
      working_days_left: workingDaysLeft,
      recommended_today_budget_units: Number(todayBudget.toFixed(2)),
      reserve_ok_now: available >= reserve
    },
    providers: providerSummary(config)
  };
}

function printHuman(result) {
  console.log(`date=${result.date}`);
  console.log(`today=${result.today}`);
  console.log(`reset_day=${result.reset_day}`);
  console.log(`days_to_reset=${result.days_to_reset}`);
  console.log(`weekend_days_left=${result.weekend_reserve.days_left.join(",") || "none"}`);
  console.log(`total_remaining_units=${result.budget.total_remaining_units}`);
  console.log(`weekend_reserve_units=${result.weekend_reserve.minimum_units}`);
  console.log(`spendable_before_reserve=${result.budget.spendable_before_reserve}`);
  console.log(`working_days_left=${result.budget.working_days_left}`);
  console.log(`recommended_today_budget_units=${result.budget.recommended_today_budget_units}`);
  console.log(`reserve_ok_now=${result.budget.reserve_ok_now}`);
  for (const provider of result.providers) {
    console.log(
      `provider.${provider.provider}=accounts:${provider.accounts},remaining:${provider.remaining_units},weekly:${provider.weekly_budget_units}`,
    );
  }
}

const options = parseArgs(process.argv.slice(2));

try {
  const config = await readJson(path.resolve(REPO_ROOT, options.config));
  const result = calculateBudget(config, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
} catch (error) {
  usage();
  console.error(`[agent-budget] FAILED: ${error.message}`);
  process.exit(1);
}
