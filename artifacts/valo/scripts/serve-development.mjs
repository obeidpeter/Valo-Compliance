// The development site as a compiled build: `pnpm --filter @workspace/valo run dev:compiled`.
//
// The development server (`next dev`) compiles each page the first time it is opened, so the first
// click on every menu item waits for a compiler, for seconds. This builds the whole site once and
// then serves the build, so every page is ready. It is the same development environment: the API
// stays in development, nothing is deployed and nothing is launched. A code change shows after a
// restart; `pnpm --filter @workspace/valo run dev` is the development server for editing sessions.
//
// While the build runs, the port answers with a short page that reloads itself. If the build fails,
// the development server is served instead, so the site stays up, and the build error is above it
// in the log.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  compiledEnvironment,
  developmentEnvironment,
  isDeployment,
  startingPage,
  startingPageHeaders,
} from "./development-site.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
if (isDeployment(process.env)) {
  console.error("dev:compiled serves the development site only. A deployment builds once and runs `serve`.");
  process.exit(1);
}
const host = "0.0.0.0";
const port = process.env.PORT || "3000";

/** Runs one Next.js command with the terminal's output, passing on a stop signal. */
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [next, ...args], { cwd: root, env, stdio: "inherit" });
    const stop = (signal) => child.kill(signal);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    child.on("exit", (code, signal) => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve({ code, signal });
    });
  });
}

// Hold the port during the build, so the workspace sees the site start and a visitor gets an answer.
const placeholder = createServer((_request, response) => {
  response.writeHead(503, startingPageHeaders);
  response.end(startingPage);
});
placeholder.listen(Number(port), host);
await once(placeholder, "listening");

const compiled = compiledEnvironment(process.env);
const build = await run(["build"], compiled);
await new Promise((done) => {
  placeholder.closeAllConnections();
  placeholder.close(() => done(undefined));
});
if (build.signal) process.exit(1);
if (build.code === 0) {
  const served = await run(["start", "--hostname", host, "--port", port], compiled);
  process.exit(served.code ?? 1);
}
console.error(
  "\nThe compiled build failed; the error is above. Serving the development server instead, so the site " +
    "stays up. Its pages compile on their first visit until the build is fixed and the site restarted.\n",
);
const development = await run(
  ["dev", "--hostname", host, "--port", port],
  developmentEnvironment(process.env),
);
process.exit(development.code ?? 1);
