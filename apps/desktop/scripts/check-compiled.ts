/**
 * C, C++ AND RUST CELLS, RUN WITH THE REAL COMPILERS (port-only: docs/PARITY.md "Evaluation cells"). Not part of
 * `npm test` — it starts clang / rustc, and a timeout case takes the runner's whole twenty seconds — and re-runnable
 * by hand:
 *
 *   node node_modules/vite-node/vite-node.mjs apps/desktop/scripts/check-compiled.ts [--quick] [--finder-path]
 *
 * Every case goes through `createProcessRunner().run`, the very code a Shift+Enter reaches, and prints the Out cell
 * the note would get (`landingFor` + `outCell`), then checks it: a value printed; a warning beside a clean run; a
 * compile error (readable, with the compiler's own file name and line); a program that exits non-zero, aborts and
 * is killed by a signal, panics; one that reads stdin (EOF); one that prints more than the cap; and — without
 * `--quick` — one that never ends (the 20 s timeout), and one the page cancels. `--finder-path` runs the whole thing
 * under the PATH a Finder-launched app inherits (`/usr/bin:/bin:/usr/sbin:/sbin`), the one that has no Homebrew and
 * no `~/.cargo/bin` on it.
 *
 * Exit code: 0 when every check holds, 1 otherwise. Languages with no tool on this machine are skipped, said so.
 */

import { evalResult, landingFor, outCell, type Evaluator } from "@writemind/core"
import { createProcessRunner } from "../src/main/eval/runner"

const quick = process.argv.includes("--quick")
if (process.argv.includes("--finder-path")) process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

const runner = createProcessRunner()
let failed = 0

const ok = (name: string, good: boolean, detail = "") => {
  if (!good) failed++
  console.log(`  ${good ? "ok  " : "FAIL"} ${name}${good ? "" : detail ? `\n         ${detail.replace(/\n/g, "\n         ")}` : ""}`)
}

interface Case {
  name: string
  source: string
  /** What the Out cell's body must match (every one). */
  has?: RegExp[]
  /** What it must not match. */
  hasNot?: RegExp[]
  slow?: boolean
}

const CASES: Record<"c" | "cpp" | "rust", Case[]> = {
  c: [
    { name: "prints a value", source: '#include <stdio.h>\nint main(void) {\n  printf("%d\\n", 6 * 7);\n  return 0;\n}',
      has: [/^42$/m], hasNot: [/\[exit/, /\[stderr\]/] },
    { name: "a warning beside a clean run", source: '#include <stdio.h>\nint main(void) {\n  int unused;\n  int x = 5;\n  printf("%d\\n", x);\n  return 0;\n}',
      has: [/^5$/m] },
    { name: "a compile error is readable", source: "int main(void) {\n  int x = ;\n  return x;\n}",
      has: [/cell\.c:2/, /error/, /\[it did not compile\]/, /\[exit 1\]/], hasNot: [/\[no output\]/] },
    { name: "exit status", source: "#include <stdlib.h>\nint main(void) { return 3; }", has: [/\[exit 3\]/] },
    { name: "killed by a signal", source: "#include <stdlib.h>\nint main(void) { abort(); }", has: [/signal|SIGABRT|abort/i], hasNot: [/\[no output\]/] },
    { name: "a segfault", source: "int main(void) { volatile int *p = 0; return *p; }", has: [/signal|SIGSEGV|SIGBUS|segmentation|bus error/i], hasNot: [/\[no output\]/] },
    { name: "reading stdin ends at once", source: '#include <stdio.h>\nint main(void) {\n  int c = getchar();\n  printf("%d\\n", c);\n  return 0;\n}',
      has: [/^-1$/m] },
    { name: "output past the cap is cut", source: '#include <stdio.h>\nint main(void) {\n  for (int i = 0; i < 100000; i++) printf("line %d of many\\n", i);\n  return 0;\n}',
      has: [/\[output cut at 64 KB\]/] },
    { name: "a loop that never ends is timed out", source: "int main(void) { for (;;) {} }", has: [/\[timed out\]/], slow: true },
  ],
  cpp: [
    { name: "prints a value", source: "#include <iostream>\nint main() {\n  std::cout << 6 * 7 << std::endl;\n}",
      has: [/^42$/m], hasNot: [/\[exit/, /\[stderr\]/] },
    { name: "uses C++20", source: '#include <iostream>\n#include <vector>\n#include <ranges>\nint main() {\n  std::vector<int> v{1,2,3,4};\n  int s = 0;\n  for (int x : v | std::views::filter([](int n){ return n % 2 == 0; })) s += x;\n  std::cout << s << "\\n";\n}',
      has: [/^6$/m] },
    { name: "a compile error is readable", source: "#include <iostream>\nint main() {\n  std::cout << undefined_name << std::endl;\n}",
      has: [/cell\.cpp:3/, /error/, /\[it did not compile\]/, /\[exit 1\]/] },
    { name: "an uncaught exception", source: '#include <stdexcept>\nint main() { throw std::runtime_error("boom"); }',
      has: [/boom/, /signal|SIGABRT|abort|terminat/i] },
    { name: "a loop that never ends is timed out", source: "int main() { for (;;) {} }", has: [/\[timed out\]/], slow: true },
  ],
  rust: [
    { name: "prints a value", source: 'fn main() {\n    println!("{}", 6 * 7);\n}', has: [/^42$/m], hasNot: [/\[exit/, /\[stderr\]/] },
    { name: "a warning beside a clean run", source: 'fn main() {\n    let unused = 1;\n    println!("hi");\n}', has: [/^hi$/m, /unused/] },
    { name: "a compile error is readable", source: "fn main() {\n    let x: i32 = \"text\";\n}",
      has: [/error/, /cell\.rs:2/, /\[it did not compile\]/, /\[exit 1\]/], hasNot: [/\[no output\]/] },
    { name: "a panic", source: 'fn main() {\n    panic!("boom");\n}', has: [/boom/, /\[exit 101\]/] },
    { name: "an overflow in a release build wraps rather than panics (-O)", source: 'fn main() {\n    let x: u8 = std::hint::black_box(255);\n    println!("{}", x.wrapping_add(1));\n}', has: [/^0$/m] },
    { name: "reading stdin ends at once", source: 'use std::io::Read;\nfn main() {\n    let mut s = String::new();\n    std::io::stdin().read_to_string(&mut s).unwrap();\n    println!("[{}]", s.len());\n}', has: [/^\[0\]$/m] },
    { name: "a loop that never ends is timed out", source: "fn main() {\n    loop {}\n}", has: [/\[timed out\]/], slow: true },
  ],
}

const TITLE: Record<string, string> = { c: "C", cpp: "C++", rust: "Rust" }

async function main(): Promise<void> {
  const tools = runner.tools()
  console.log("PATH for the run:", process.env.PATH)
  for (const evaluator of ["c", "cpp", "rust"] as const) {
    const where = tools[evaluator].path
    console.log(`\n== ${TITLE[evaluator]}: ${where ?? "NOT FOUND (looked: " + tools[evaluator].looked.join(", ") + ")"}`)
    if (!where) { console.log("  skipped"); continue }
    for (const one of CASES[evaluator]) {
      if (one.slow && quick) continue
      const started = Date.now()
      const outcome = await runner.run({ id: `check:${evaluator}:${one.name}`, evaluator: evaluator as Evaluator, source: one.source })
      const landed = landingFor(outcome, evaluator)
      const cell = landed.kind === "write" ? outCell(landed.result)
        : landed.kind === "say" ? `(says) ${landed.message}` : "(nothing)"
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`- ${one.name} (${seconds} s)`)
      console.log(cell.split("\n").slice(0, 14).map((line) => `    | ${line.slice(0, 150)}`).join("\n"))
      const missing = (one.has ?? []).filter((expression) => !expression.test(cell))
      const unwanted = (one.hasNot ?? []).filter((expression) => expression.test(cell))
      ok(one.name, missing.length === 0 && unwanted.length === 0,
        [...missing.map((m) => `expected ${m}`), ...unwanted.map((m) => `did not expect ${m}`)].join("\n"))
    }
    if (!quick) {
      // A run the page takes back: nothing is written and nothing is said, and the compiler / program is killed.
      const id = `check:${evaluator}:cancel`
      const pending = runner.run({ id, evaluator: evaluator as Evaluator, source: evaluator === "rust" ? "fn main() { loop {} }" : "int main() { for (;;) {} }" })
      await new Promise((resolve) => setTimeout(resolve, 2500))
      runner.cancel(id)
      const outcome = await pending
      ok("a cancelled run lands nothing", outcome.kind === "cancelled" && runner.inFlight() === 0, JSON.stringify(outcome))
    }
  }
  // Nothing may be left running.
  const leftovers = await import("node:child_process").then((m) => m.execFileSync("pgrep", ["-fl", "WriteMind-eval-"]).toString()).catch(() => "")
  ok("no scratch program is left running", leftovers.trim() === "", leftovers)
  void evalResult
  console.log(failed === 0 ? "\nALL CHECKS HOLD" : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
