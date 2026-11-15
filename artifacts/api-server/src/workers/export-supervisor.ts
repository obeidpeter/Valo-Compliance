import {fileURLToPath} from "node:url";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
import {launchBuiltWorker, superviseWorker} from "../lib/valo-worker-supervisor";
import {ExternalMonitor,externalMonitorConfiguration} from "../lib/valo-external-monitor";

// This candidate does not bypass the existing production activation boundary.
assertDevelopmentRuntime();
const monitoring=new ExternalMonitor(externalMonitorConfiguration(),event=>console.log(JSON.stringify(event)));
monitoring.start();
const shutdown = new AbortController();
process.on("SIGTERM", () => shutdown.abort());
process.on("SIGINT", () => shutdown.abort());
const exitCode = await superviseWorker({
  signal: shutdown.signal,
  launch: () => launchBuiltWorker(fileURLToPath(new URL("./export-worker.mjs", import.meta.url))),
  report: event => console.log(JSON.stringify(event)),
  observeWorker:health=>monitoring.observeWorker(health),
  observeOperations:value=>monitoring.observeOperations(value),
});
await monitoring.stop();
// Also bounds an unconfirmed OS kill: never start another worker in that case.
process.exit(exitCode);
