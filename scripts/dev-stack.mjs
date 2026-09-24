#!/usr/bin/env node
/**
 * Full-stack development launcher.
 *
 * `npm run dev` runs this script, which makes the frontend command mean "the whole app":
 *
 *   1. Fills in missing env files (`backend/.env`, `.env.local`) from the shipped examples,
 *      generating a real DJANGO_SECRET_KEY on first run.
 *   2. Creates the Python virtual environment in `backend/.venv` and installs
 *      `backend/requirements.lock` into it — again only when the lockfile changed.
 *   3. Applies database migrations (`migrate`). If models moved ahead of the migration files,
 *      it makes the migrations first, so a fresh clone never serves a stale schema.
 *   4. Starts Django on 127.0.0.1:8000 and Next.js on 0.0.0.0:3000, with prefixed logs.
 *      If a healthy API already answers on the port, it is reused instead of double-started.
 *   5. One Ctrl+C stops both processes (whole process tree, on every OS).
 *
 * Flags:
 *   --web-only     Only the Next.js dev server (old `npm run dev` behaviour).
 *   --api-only     Only the backend setup + Django.
 *   --setup-only   Prepare env/venv/dependencies/migrations, then exit without serving.
 *   --turbo        Run Next.js with --turbo.
 *   --port N       Frontend port (default 3000, or PORT env).
 *   --api-port N   Backend port (default 8000, or API_PORT env).
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const VENV_DIR = path.join(BACKEND_DIR, ".venv");
const IS_WIN = process.platform === "win32";

const args = new Set(process.argv.slice(2));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const WEB_ONLY = args.has("--web-only");
const API_ONLY = args.has("--api-only");
const SETUP_ONLY = args.has("--setup-only");
const TURBO = args.has("--turbo") || process.env.NEXT_TURBO === "1";
const WEB_PORT = String(flagValue("--port", process.env.PORT || 3000));
const API_PORT = String(flagValue("--api-port", process.env.API_PORT || 8000));
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

/* ------------------------------------------------------------- logging --- */
const COLORS = { stack: "\x1b[36m", api: "\x1b[35m", web: "\x1b[34m", dim: "\x1b[2m", reset: "\x1b[0m" };
function log(tag, message) {
  const color = COLORS[tag] || COLORS.stack;
  for (const line of String(message).replace(/\r/g, "").split("\n")) {
    if (line.trim() !== "") console.log(`${color}[${tag}]${COLORS.reset} ${line}`);
  }
}
const info = (m) => log("stack", m);
const fail = (m) => {
  log("stack", `✖ ${m}`);
  process.exit(1);
};

/* ------------------------------------------------------------ spawning --- */
function run(cmd, cmdArgs, opts = {}) {
  const label = opts.label || path.basename(cmd);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    stdio: opts.quiet ? "pipe" : ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !opts.allowFailure) {
    if (result.stdout) log(opts.tag || "api", result.stdout);
    if (result.stderr) log(opts.tag || "api", result.stderr);
    fail(`\`${label} ${cmdArgs.join(" ")}\` failed with exit code ${result.status}.`);
  }
  return result;
}

const children = [];
function serve(name, tag, cmd, cmdArgs, opts = {}) {
  info(`starting ${name}: ${cmdArgs.join(" ")}`);
  const child = spawn(cmd, cmdArgs, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, FORCE_COLOR: "1", ...opts.env },
    // Own process group on POSIX so the whole tree (Django's autoreloader spawns a
    // child) receives the shutdown signal together.
    detached: !IS_WIN,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forward = (chunk) => log(tag, chunk);
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0 && code !== null) {
      log(tag, `${name} exited unexpectedly (code ${code}). Shutting down the stack.`);
      shutdown(code ?? 1);
    } else if (!shuttingDown && signal === null && code === 0) {
      log(tag, `${name} stopped.`);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function killTree(child) {
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM"); // negative pid: the whole group
    }
  } catch {
    /* already gone */
  }
}
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  info("shutting down…");
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 500).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/* ----------------------------------------------------------- env files --- */
function ensureEnvFiles() {
  const backendEnv = path.join(BACKEND_DIR, ".env");
  if (!fs.existsSync(backendEnv)) {
    const example = fs.readFileSync(path.join(BACKEND_DIR, ".env.example"), "utf8");
    const secret = crypto.randomBytes(48).toString("base64url");
    const contents = example.replace("replace-with-a-long-unique-secret", secret);
    fs.writeFileSync(backendEnv, contents);
    info("created backend/.env from the example (generated a fresh DJANGO_SECRET_KEY).");
  }
  const frontendEnv = path.join(ROOT, ".env.local");
  if (!fs.existsSync(frontendEnv)) {
    fs.copyFileSync(path.join(ROOT, ".env.local.example"), frontendEnv);
    info("created .env.local from .env.local.example (Next.js will proxy /api/v1 to Django).");
  }
}

/* -------------------------------------------------------------- python --- */
function findPython() {
  for (const candidate of IS_WIN ? ["python", "py"] : ["python3", "python"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  fail("Python 3.12+ was not found on PATH. Install it from https://www.python.org and retry.");
}
function venvPython() {
  return IS_WIN
    ? path.join(VENV_DIR, "Scripts", "python.exe")
    : path.join(VENV_DIR, "bin", "python");
}

/** Create backend/.venv on first run. */
function ensureVenv() {
  if (fs.existsSync(venvPython())) return;
  const python = findPython();
  info("creating the backend virtual environment (backend/.venv)…");
  run(python, ["-m", "venv", VENV_DIR], { label: "python -m venv" });
}

/** Install requirements.lock only when its hash changed since the last install. */
function ensureDependencies() {
  const lockfile = path.join(BACKEND_DIR, "requirements.lock");
  const hash = crypto.createHash("sha256").update(fs.readFileSync(lockfile)).digest("hex");
  const stamp = path.join(VENV_DIR, ".requirements-sha256");
  const py = venvPython();
  const djangoMissing =
    spawnSync(py, ["-c", "import django"], { stdio: "ignore" }).status !== 0;
  if (!djangoMissing && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === hash) return;
  info("installing backend dependencies from requirements.lock…");
  run(py, ["-m", "pip", "install", "-q", "-r", "requirements.lock"], {
    cwd: BACKEND_DIR,
    label: "pip install",
    env: { PIP_DISABLE_PIP_VERSION_WARNING: "1" },
  });
  fs.writeFileSync(stamp, hash);
}

/* --------------------------------------------------------- migrations --- */
function manage(pyArgs, opts = {}) {
  return run(venvPython(), ["manage.py", ...pyArgs], { cwd: BACKEND_DIR, tag: "api", ...opts });
}

function migrate() {
  info("checking for model changes not yet captured in a migration…");
  const check = manage(["makemigrations", "--check", "--dry-run"], {
    quiet: true,
    allowFailure: true,
  });
  if (check.status !== 0) {
    info("model changes detected — making migrations automatically (dev convenience).");
    manage(["makemigrations"]);
  }
  info("applying database migrations…");
  const out = manage(["migrate", "--noinput"], { quiet: true });
  const summary = (out.stdout || "").trim().split("\n").filter((l) => /Applying|No migrations|unapply/i.test(l));
  info(summary.length ? summary.join(" · ") : "database schema is up to date.");
}

/* ------------------------------------------------------------- health --- */
async function apiHealthy() {
  try {
    const res = await fetch(`${API_ORIGIN}/health/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
async function waitForApi(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await apiHealthy()) return true;
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

/* ------------------------------------------------------------- servers --- */
async function startApi() {
  if (await apiHealthy()) {
    info(`an API already answers on ${API_ORIGIN} — reusing it (it will NOT be stopped on exit).`);
    return;
  }
  serve("Django API", "api", venvPython(), ["manage.py", "runserver", `127.0.0.1:${API_PORT}`], {
    cwd: BACKEND_DIR,
    env: { PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1", DJANGO_DEBUG: "true" },
  });
  info(`waiting for the API on ${API_ORIGIN}/health/ …`);
  if (!(await waitForApi())) fail("the API did not become healthy within 60s — see [api] logs above.");
  info(`API is up: ${API_ORIGIN}/api/v1/`);
}

function ensureNodeModules() {
  if (fs.existsSync(path.join(ROOT, "node_modules", "next"))) return;
  info("node_modules missing — running `npm install` first…");
  run(IS_WIN ? "npm.cmd" : "npm", ["install"], { label: "npm install" });
}

function startWeb() {
  ensureNodeModules();
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const nextArgs = [nextBin, "dev", "-p", WEB_PORT, "-H", "0.0.0.0"];
  if (TURBO) nextArgs.push("--turbo");
  serve("Next.js", "web", process.execPath, nextArgs, {
    env: { API_PROXY_TARGET: process.env.API_PROXY_TARGET || API_ORIGIN },
  });
  info(`frontend is starting on http://localhost:${WEB_PORT}`);
}

/* --------------------------------------------------------------- main --- */
async function main() {
  info("Examora dev stack — one command, whole app. Ctrl+C stops everything.");
  ensureEnvFiles();
  if (!WEB_ONLY) {
    ensureVenv();
    ensureDependencies();
    migrate();
  }
  if (SETUP_ONLY) {
    info("setup complete (--setup-only): env files, virtualenv, dependencies and migrations are done.");
    return;
  }
  if (!WEB_ONLY) await startApi();
  if (!API_ONLY) startWeb();
  info(WEB_ONLY ? "running the frontend only." : API_ONLY ? "running the API only." : "frontend + backend are running together.");
}

main().catch((error) => fail(error?.message || error));
