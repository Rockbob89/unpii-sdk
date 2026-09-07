#!/usr/bin/env node
import { ArgsError, parseArgs } from "./args.js";
import { invalidResponseMessage, unexpectedErrorMessage } from "./messages.js";
import { type RunIO, runCli } from "./run.js";

/**
 * The only file in this package allowed to touch `process.exit`/`process.exitCode` — everything
 * else (`args.ts`, `run.ts`, `messages.ts`) is pure/testable in isolation.
 *
 * `process.exit()` rather than plain `process.exitCode` is deliberate: Node's global `fetch`
 * (undici) keeps a keep-alive connection pool open, which can keep the event loop alive well
 * past the point where this CLI has finished its work, so the process would otherwise hang
 * instead of exiting. `runCli` already awaits every write's callback before resolving (see
 * `write()` in run.ts), so stdout/stderr are flushed by the time we get here — nothing is
 * truncated by exiting immediately after.
 */
async function main(): Promise<number> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const io: RunIO = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
    return await runCli(args, process.env, io);
  } catch (err) {
    if (err instanceof ArgsError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    // Last-resort: runCli() catches everything it expects to see (UnpiiError, fs errors, and the
    // response-body SyntaxError case — run.ts), so reaching here means something unanticipated
    // broke. Same SyntaxError carve-out as run.ts's catch, as defense in depth: nothing below
    // main() should let a raw JSON-parse error's message (which can quote parsed content) reach
    // this far, but if one ever does, it is still not forwarded.
    if (err instanceof SyntaxError) {
      process.stderr.write(invalidResponseMessage());
      return 1;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(unexpectedErrorMessage(message));
    return 1;
  }
}

main().then((code) => {
  process.exit(code);
});
