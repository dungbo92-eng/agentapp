#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.resolve(process.env.AGENTAPP_DATA_DIR || path.join(REPO_ROOT, "data"));
const VAULT_FILE = path.join(DATA_DIR, "credential-vault.json");

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function runPowerShell(script, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `PowerShell exited with ${code}`));
      }
    });

    child.stdin.end(stdin, "utf8");
  });
}

async function encryptWithDpapi(secret) {
  if (process.platform !== "win32") {
    throw new Error("encrypted credential storage currently requires Windows DPAPI");
  }

  const script = [
    "$plain = [Console]::In.ReadToEnd()",
    "$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force",
    "$secure | ConvertFrom-SecureString",
  ].join("; ");

  return runPowerShell(script, secret);
}

async function readVault() {
  try {
    const parsed = JSON.parse(await readFile(VAULT_FILE, "utf8"));
    return {
      version: 1,
      credentials: parsed.credentials && typeof parsed.credentials === "object" ? parsed.credentials : {},
    };
  } catch {
    return { version: 1, credentials: {} };
  }
}

async function writeVault(vault) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(VAULT_FILE, `${JSON.stringify(vault, null, 2)}\n`, "utf8");
}

export async function storeCredential(input) {
  const accountId = normalizeId(input.accountId || input.account_id);
  const kind = normalizeId(input.kind || "password");
  const secret = String(input.secret || "");

  if (!accountId) throw new Error("missing accountId");
  if (!secret) throw new Error("missing secret");

  const credentialRef = `${accountId}/${kind}`;
  const vault = await readVault();
  vault.credentials[credentialRef] = {
    credentialRef,
    accountId,
    kind,
    storage: "windows-dpapi",
    ciphertext: await encryptWithDpapi(secret),
    updatedAt: new Date().toISOString(),
  };
  await writeVault(vault);

  return {
    credentialRef,
    credentialStatus: "stored",
    storage: "windows-dpapi",
    updatedAt: vault.credentials[credentialRef].updatedAt,
  };
}

export async function credentialMetadata(accountId, kind = "password") {
  const credentialRef = `${normalizeId(accountId)}/${normalizeId(kind)}`;
  const vault = await readVault();
  const item = vault.credentials[credentialRef];
  if (!item) return { credentialRef, credentialStatus: "empty" };
  return {
    credentialRef,
    credentialStatus: "stored",
    storage: item.storage,
    updatedAt: item.updatedAt,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const accountId = process.argv[2];
  const secret = process.env.AGENTAPP_SECRET;
  if (!accountId || !secret) {
    console.log("usage: set AGENTAPP_SECRET and run node scripts/credential-vault.mjs <account-id>");
    process.exit(1);
  }
  console.log(JSON.stringify(await storeCredential({ accountId, secret }), null, 2));
}
