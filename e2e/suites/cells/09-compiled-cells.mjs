// C, C++ and Rust evaluation cells RUN FOR REAL in the app (Shift+Enter in the cell, the shell's runner, the machine's own
// compilers), and the answer the note gets is right: a value printed, a compile error with the compiler's own words and
// no scratch-folder path, a crash that names its signal (it used to read "[no output]"), a panic, an exit status. Each
// language is skipped, said so, when this machine has no compiler for it (the report the Runs As menu uses says which).
// Nothing here is Windows-specific and nothing proves Windows: it is whatever compiler this machine has.
import { ok, skip, finish, js, sleep, setDoc, setRendered, focus, key, doc, shot, waitFor, freshNote, SHIFT } from "../../lib/harness.mjs"

await freshNote()
await setRendered(false)

const tools = JSON.parse(await js(`window.wm.evaluate.tools().then((t) => JSON.stringify(t))`))
const FENCE = { c: "c", cpp: "c++", rust: "rust" }

/** Run one cell with a real Shift+Enter, wait for its answer, and return the whole note. */
async function run(evaluator, source) {
  const before = "```eval " + FENCE[evaluator] + "\n" + source + "\n```\n"
  await setDoc(before, ("```eval " + FENCE[evaluator] + "\n").length + 1)
  await focus(); await sleep(300)
  await key("Enter", { shift: true, wait: 200 })
  await waitFor(`${"document.querySelector('.cm-content').cmTile.view"}.state.doc.toString().includes('\`\`\`out')`, 60000)
  await sleep(300)
  return doc()
}
const out = (note) => (note.match(/```out\n([\s\S]*?)\n```/) ?? [])[1] ?? null
const SIGNAL = /\[stopped by SIG(SEGV|ABRT|BUS|ILL|TRAP) \(/

const CASES = {
  c: {
    value: '#include <stdio.h>\nint main(void) {\n  printf("%d\\n", 6 * 7);\n  return 0;\n}',
    broken: "int main(void) {\n  int x = ;\n  return x;\n}",
    crash: "int main(void) { volatile int *p = 0; return *p; }",
    exit: "int main(void) { return 3; }",
  },
  cpp: {
    value: "#include <iostream>\nint main() {\n  std::cout << 6 * 7 << std::endl;\n}",
    broken: "#include <iostream>\nint main() {\n  std::cout << nope << std::endl;\n}",
    crash: '#include <stdexcept>\nint main() { throw std::runtime_error("boom"); }',
    exit: "int main() { return 3; }",
  },
  rust: {
    value: 'fn main() {\n    println!("{}", 6 * 7);\n}',
    broken: 'fn main() {\n    let x: i32 = "text";\n}',
    panic: 'fn main() {\n    panic!("boom");\n}',
    exit: "fn main() {\n    std::process::exit(3);\n}",
  },
}

for (const evaluator of ["c", "cpp", "rust"]) {
  if (!tools[evaluator]?.path) { skip(`${evaluator}: no compiler on this machine`, tools[evaluator]?.looked?.join(", ") ?? ""); continue }
  const c = CASES[evaluator]

  let answer = out(await run(evaluator, c.value))
  ok(`${evaluator}: a program that prints 42 gets an Out cell that says 42, and nothing else`, answer === "42", JSON.stringify(answer))
  const shown = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.wm-eval-label')].map((l) => l.textContent))`))
  ok(`${evaluator}: the marks became In[1] and Out[1]`, shown.join(",") === "In[1],Out[1]", JSON.stringify(shown))
  if (evaluator === "c") await shot("c-answer")

  answer = out(await run(evaluator, c.broken))
  ok(`${evaluator}: a compile error is the answer, in the compiler's words`, /\[stderr\]\n/.test(answer ?? "") && /error/.test(answer ?? "")
    && /\[it did not compile\]/.test(answer ?? "") && /\[exit 1\]/.test(answer ?? ""), JSON.stringify(answer))
  ok(`${evaluator}: and it names cell.${evaluator === "rust" ? "rs" : evaluator === "c" ? "c" : "cpp"} with the line, not a temp folder`,
    new RegExp(`(^|[ \\n])cell\\.${evaluator === "rust" ? "rs" : evaluator === "c" ? "c" : "cpp"}:\\d+`).test(answer ?? "") && !/WriteMind-eval|\/var\/|\/tmp\//.test(answer ?? ""), JSON.stringify(answer))
  if (evaluator === "cpp") await shot("cpp-compile-error")

  if (c.crash) {
    answer = out(await run(evaluator, c.crash))
    ok(`${evaluator}: a crash says which signal ended the program`, SIGNAL.test(answer ?? ""), JSON.stringify(answer))
  }
  if (c.panic) {
    answer = out(await run(evaluator, c.panic))
    ok(`${evaluator}: a panic shows its message and the exit status`, /boom/.test(answer ?? "") && /\[exit 101\]/.test(answer ?? "") && !/WriteMind-eval|\/var\//.test(answer ?? ""), JSON.stringify(answer))
  }
  answer = out(await run(evaluator, c.exit))
  ok(`${evaluator}: a non-zero exit is said`, answer === "[exit 3]", JSON.stringify(answer))
}

finish()
