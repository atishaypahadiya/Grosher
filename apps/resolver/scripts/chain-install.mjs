// Installs the two LaunchAgents that keep the Mac side of the resolver chain up across reboots:
//
//   dev.grosher.ollama  at login: launchctl setenv OLLAMA_HOST / OLLAMA_ORIGINS / OLLAMA_KEEP_ALIVE, open the
//                       Ollama menu-bar app, wait for it, warm qwen3:8b (scripts/ollama-login.sh)
//   dev.grosher.gate    scripts/ollama-gate.mjs on 127.0.0.1:11435, KeepAlive, token from
//                       ~/.config/grosher/ollama-token (chmod 600; never in the plist or the repo)
//
// Logs: ~/Library/Logs/grosher-ollama.log, ~/Library/Logs/grosher-gate.log.
// The Funnel (tailscale funnel --bg 11435) persists in tailscaled itself and needs no agent.
//
//   npm run chain:install -w @grosher/resolver               # write both plists, stop a hand-run gate, load them
//   npm run chain:install -w @grosher/resolver -- --uninstall

import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const UID = userInfo().uid;
const AGENTS = join(HOME, "Library/LaunchAgents");
const LOGS = join(HOME, "Library/Logs");
const TOKEN_FILE = join(HOME, ".config/grosher/ollama-token");
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const RESOLVER = resolve(SCRIPTS, "..");
const GATE_PORT = 11435;

/** node by its PATH name (/opt/homebrew/bin/node), not the Cellar path, so a brew upgrade does not break the agent */
function nodePath() {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = join(dir, "node");
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {}
  }
  return process.execPath;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plist = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
const args = (xs) => `  <key>ProgramArguments</key>\n  <array>\n${xs.map((x) => `    <string>${esc(x)}</string>`).join("\n")}\n  </array>`;
const str = (k, v) => `  <key>${k}</key>\n  <string>${esc(v)}</string>`;

const agents = [
  {
    label: "dev.grosher.ollama",
    body: [
      str("Label", "dev.grosher.ollama"),
      args(["/bin/sh", join(SCRIPTS, "ollama-login.sh")]),
      "  <key>RunAtLoad</key>\n  <true/>",
      str("StandardOutPath", join(LOGS, "grosher-ollama.log")),
      str("StandardErrorPath", join(LOGS, "grosher-ollama.log")),
    ],
  },
  {
    label: "dev.grosher.gate",
    body: [
      str("Label", "dev.grosher.gate"),
      args([nodePath(), join(SCRIPTS, "ollama-gate.mjs")]),
      str("WorkingDirectory", RESOLVER),
      `  <key>EnvironmentVariables</key>\n  <dict>\n    <key>OLLAMA_TOKEN_FILE</key>\n    <string>${esc(TOKEN_FILE)}</string>\n  </dict>`,
      "  <key>RunAtLoad</key>\n  <true/>",
      "  <key>KeepAlive</key>\n  <true/>",
      "  <key>ThrottleInterval</key>\n  <integer>5</integer>",
      str("StandardOutPath", join(LOGS, "grosher-gate.log")),
      str("StandardErrorPath", join(LOGS, "grosher-gate.log")),
    ],
  },
];

const sh = (cmd, a, opts = {}) => {
  try {
    return execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
  } catch (e) {
    if (opts.allowFail) return null;
    throw e;
  }
};
const bootout = (label) => sh("/bin/launchctl", ["bootout", `gui/${UID}/${label}`], { allowFail: true });

if (process.argv.includes("--uninstall")) {
  for (const a of agents) {
    bootout(a.label);
    rmSync(join(AGENTS, `${a.label}.plist`), { force: true });
    console.log(`removed ${a.label}`);
  }
  process.exit(0);
}

// the token file must exist and be private before the gate agent can start
if (!existsSync(TOKEN_FILE)) {
  console.error(`✗ no token at ${TOKEN_FILE}\n  umask 077; mkdir -p ~/.config/grosher; openssl rand -hex 24 | tr -d '\\n' > ${TOKEN_FILE}\n  then: npx wrangler secret put OLLAMA_TOKEN (same value)`);
  process.exit(1);
}
if (statSync(TOKEN_FILE).mode & 0o077) {
  console.error(`✗ ${TOKEN_FILE} is readable by others: chmod 600 ${TOKEN_FILE}`);
  process.exit(1);
}

mkdirSync(AGENTS, { recursive: true });
mkdirSync(LOGS, { recursive: true });
for (const a of agents) bootout(a.label);

// a gate started by hand holds :11435; stop it so the agent's gate can bind (only ever an ollama-gate.mjs)
for (const pid of (sh("/usr/sbin/lsof", ["-t", "-nP", `-iTCP:${GATE_PORT}`, "-sTCP:LISTEN"], { allowFail: true }) ?? "").split("\n").filter(Boolean)) {
  const cmd = sh("/bin/ps", ["-o", "command=", "-p", pid], { allowFail: true }) ?? "";
  if (!cmd.includes("ollama-gate.mjs")) {
    console.error(`✗ :${GATE_PORT} is held by something else (pid ${pid}: ${cmd}); stop it first`);
    process.exit(1);
  }
  process.kill(Number(pid), "SIGTERM");
  console.log(`stopped the hand-run gate (pid ${pid})`);
}
for (let i = 0; i < 20 && sh("/usr/sbin/lsof", ["-t", `-iTCP:${GATE_PORT}`, "-sTCP:LISTEN"], { allowFail: true }); i++) await new Promise((r) => setTimeout(r, 250));

for (const a of agents) {
  const file = join(AGENTS, `${a.label}.plist`);
  writeFileSync(file, plist(a.body.join("\n")), { mode: 0o644 });
  sh("/usr/bin/plutil", ["-lint", file]);
  sh("/bin/launchctl", ["bootstrap", `gui/${UID}`, file]);
  console.log(`loaded ${a.label} (${file})`);
}
console.log("check: npm run chain:status -w @grosher/resolver");
