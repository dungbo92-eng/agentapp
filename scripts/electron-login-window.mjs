#!/usr/bin/env node

// Per-account isolated Chromium login window backed by Electron BrowserWindow
// partitions. Each account uses a dedicated `persist:login-<key>` partition so
// that cookies, localStorage, and IndexedDB are fully isolated between accounts.
// Optional autofill injects the account email (and password on allowlisted
// hosts) on the first login so the user only has to handle 2FA/captcha and the
// OAuth consent click.

function sanitizePartition(value) {
  return String(value || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

const PASSWORD_HOST_ALLOWLIST = [
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)login\.microsoftonline\.com$/i,
  /(^|\.)login\.live\.com$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)auth\.openai\.com$/i,
  /(^|\.)login\.openai\.com$/i,
  /(^|\.)console\.anthropic\.com$/i,
  /(^|\.)claude\.ai$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)cursor\.com$/i,
  /(^|\.)cursor\.sh$/i,
];

function escapeJsString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function buildAutofillScript({ email, password, allowPassword }) {
  const emailLiteral = `'${escapeJsString(email || "")}'`;
  const passwordLiteral = allowPassword && password ? `'${escapeJsString(password)}'` : "''";
  return `
    (function () {
      try {
        var email = ${emailLiteral};
        var password = ${passwordLiteral};
        if (!email) return;
        function fire(el, value) {
          if (!el) return false;
          var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          var setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
          if (setter) { setter.call(el, value); } else { el.value = value; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        function pickEmailInput() {
          var sel = [
            "input[autocomplete='username']",
            "input[type='email']",
            "input[name='identifier']",
            "input[name='email']",
            "input[name='username']",
            "input[id*='email' i]",
            "input[id*='user' i]",
            "input[aria-label*='email' i]",
            "input[aria-label*='이메일']",
          ];
          for (var i = 0; i < sel.length; i++) {
            var el = document.querySelector(sel[i]);
            if (el && el.offsetParent !== null && !el.disabled && !el.readOnly && !el.value) return el;
          }
          return null;
        }
        function pickPasswordInput() {
          var sel = [
            "input[autocomplete='current-password']",
            "input[autocomplete='new-password']",
            "input[type='password']",
            "input[name='password']",
            "input[aria-label*='password' i]",
            "input[aria-label*='비밀번호']",
          ];
          for (var i = 0; i < sel.length; i++) {
            var el = document.querySelector(sel[i]);
            if (el && el.offsetParent !== null && !el.disabled && !el.readOnly && !el.value) return el;
          }
          return null;
        }
        var emailInput = pickEmailInput();
        if (emailInput) fire(emailInput, email);
        if (password) {
          var pwInput = pickPasswordInput();
          if (pwInput) fire(pwInput, password);
        }
      } catch (e) {
        // best-effort, never throw inside autofill
      }
    })();
  `;
}

function passwordAllowedForHost(host) {
  return PASSWORD_HOST_ALLOWLIST.some((pattern) => pattern.test(host));
}

async function loadElectron() {
  try {
    const mod = await import("electron");
    return mod.default || mod;
  } catch {
    return null;
  }
}

/**
 * Opens an isolated Chromium window for the given account/login URL.
 * Returns when the window is closed by the user (after OAuth completes) or
 * the underlying CLI session ends.
 */
export async function openIsolatedLoginWindow({
  partitionKey,
  url,
  title,
  autofill,
  width = 1100,
  height = 820,
}) {
  if (!process.versions.electron) {
    return { ok: false, reason: "not-electron" };
  }
  const electron = await loadElectron();
  if (!electron) return { ok: false, reason: "electron-import-failed" };
  const { BrowserWindow, app } = electron;
  if (!BrowserWindow || !app) return { ok: false, reason: "electron-api-missing" };
  if (!app.isReady()) {
    try {
      await app.whenReady();
    } catch {
      return { ok: false, reason: "electron-not-ready" };
    }
  }

  const partition = `persist:login-${sanitizePartition(partitionKey)}`;

  return new Promise((resolve) => {
    let win;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      win = new BrowserWindow({
        width,
        height,
        show: true,
        autoHideMenuBar: true,
        title: title || "AgentApp 로그인",
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
    } catch (error) {
      done({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    win.once("ready-to-show", () => {
      try {
        win.show();
        win.focus();
      } catch {
        // best-effort focus
      }
    });

    if (autofill && (autofill.email || autofill.password)) {
      win.webContents.on("did-finish-load", () => {
        try {
          const currentUrl = new URL(win.webContents.getURL());
          const allowPassword = passwordAllowedForHost(currentUrl.hostname);
          const script = buildAutofillScript({
            email: autofill.email || "",
            password: autofill.password || "",
            allowPassword,
          });
          win.webContents.executeJavaScript(script, true).catch(() => {});
        } catch {
          // ignore URL parse / injection errors; user can still type manually
        }
      });
    }

    win.on("closed", () => done({ ok: true, closed: true, partition }));
    win.loadURL(url).catch((error) => {
      done({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        partition,
      });
      try {
        win.close();
      } catch {
        // window may already be gone
      }
    });
  });
}
