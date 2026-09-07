import { parseArgs as parseNodeArgs } from "node:util";
import type { MarkerFormat } from "@unpii/sdk";

/** Every value `MarkerFormat` can take, kept in sync with the SDK's generated union by the
 * compiler: adding a value here that isn't part of the imported type is a type error. There is
 * no runtime way to enumerate a string-literal union, so this array is the one place that has
 * to be listed by hand. */
const MARKER_FORMATS: readonly MarkerFormat[] = ["default", "custom", "xxxxx", "blackbar"];

/** Thrown for anything wrong with how the tool was invoked — an unknown flag, a bad `--marker`
 * value, too many positionals, `restore` without `--from`. The caller (`run.ts`/`cli.ts`) turns
 * this into exit code 2. Never thrown for anything that happens once a network call is made. */
export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgsError";
  }
}

interface BaseArgs {
  help: boolean;
  version: boolean;
}

export interface RunArgs extends BaseArgs {
  command: "run";
  /** Positional input path. `undefined` means "read from stdin". */
  path: string | undefined;
  out: string | undefined;
  scan: boolean;
  json: boolean;
  marker: MarkerFormat | undefined;
  keep: string[] | undefined;
}

export interface RestoreArgs extends BaseArgs {
  command: "restore";
  /** Required unless `--help` was also given — enforced below, not by the type, because
   * `--help` must still parse even without `--from`. */
  from: string | undefined;
  /** Positional answer path. `undefined` means "read from stdin". */
  path: string | undefined;
  out: string | undefined;
}

export type ParsedArgs = RunArgs | RestoreArgs;

const OPTIONS = {
  out: { type: "string" },
  scan: { type: "boolean" },
  json: { type: "boolean" },
  marker: { type: "string" },
  keep: { type: "string" },
  from: { type: "string" },
  help: { type: "boolean" },
  version: { type: "boolean" },
} as const;

function isMarkerFormat(value: string): value is MarkerFormat {
  return (MARKER_FORMATS as readonly string[]).includes(value);
}

// A tiny wrapper so `parseArgs` below can use `ReturnType<typeof parseWithNodeUtil>` to get its
// exact inferred `{ values, positionals }` shape without repeating the parse config as an
// explicit (and, tried once, TS2559-incompatible) generic type argument to `node:util`'s own
// `parseArgs`.
function parseWithNodeUtil(argv: string[]) {
  return parseNodeArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
}

/**
 * Parses argv (already stripped of `node`/script path — i.e. `process.argv.slice(2)`) into a
 * `ParsedArgs`, or throws `ArgsError`. Pure: no I/O, no environment access, no `process.exit` —
 * that split is why `cli.ts` is the only file allowed to touch `process.exit`.
 *
 * There is deliberately no `--key` option: a key argument would land in shell history. It is
 * absent from `OPTIONS` above, so `node:util`'s `parseArgs` rejects `--key` itself (strict
 * mode) exactly like any other unrecognized flag — nothing has to special-case it.
 *
 * `restore` is a subcommand, recognized as a literal first positional (`argv[0] === "restore"`),
 * the same way git-style CLIs do it — not a flag. A file that happens to be named literally
 * `restore` and is meant as the main command's input is out of scope; pass its path with `--`
 * disambiguation is not supported either. Nobody has hit this in practice.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let raw: ReturnType<typeof parseWithNodeUtil>;
  try {
    raw = parseWithNodeUtil(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ArgsError(`Ungueltige Argumente: ${message}`);
  }
  const { values, positionals } = raw;

  const help = values.help === true;
  const version = values.version === true;

  const isRestore = positionals[0] === "restore";
  const rest = isRestore ? positionals.slice(1) : positionals;
  if (rest.length > 1) {
    throw new ArgsError("Nur ein Pfad ist erlaubt.");
  }
  const path = rest[0];
  const out = typeof values.out === "string" ? values.out : undefined;

  if (isRestore) {
    const from = typeof values.from === "string" ? values.from : undefined;
    if (!help && !version && from === undefined) {
      throw new ArgsError("restore braucht --from <pfad>.");
    }
    return { command: "restore", help, version, from, path, out };
  }

  // Below this point only the "run" command's own options are validated — skipped entirely for
  // --help/--version so `unpii --help --marker=bogus` still shows help instead of complaining
  // about a flag value nobody is going to act on.
  let marker: MarkerFormat | undefined;
  if (!help && !version && typeof values.marker === "string") {
    if (!isMarkerFormat(values.marker)) {
      throw new ArgsError(
        `Ungueltiges --marker: ${values.marker}. Erlaubt: ${MARKER_FORMATS.join(", ")}.`,
      );
    }
    marker = values.marker;
  }

  let keep: string[] | undefined;
  if (typeof values.keep === "string") {
    keep = values.keep
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return {
    command: "run",
    help,
    version,
    path,
    out,
    scan: values.scan === true,
    json: values.json === true,
    marker,
    keep,
  };
}
