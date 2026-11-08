// The hidden tests' harness. A check runs as `node bench/<task>/check.mjs <workspace>`
// after the solver has finished; the solver never sees it. It prints each failed
// case, then one JSON line with the counts, and exits 1 unless every case passed.
import { pathToFileURL } from "node:url"
import { join } from "node:path"
import { existsSync } from "node:fs"

export async function suite(file, cases) {
  const workspace = process.argv[2]
  const target = join(workspace, file)
  if (!existsSync(target)) {
    console.log(`missing ${file}`)
    console.log(JSON.stringify({ passed: 0, total: 1 }))
    process.exit(1)
  }
  let mod
  try {
    mod = await import(pathToFileURL(target).href)
  } catch (e) {
    console.log(`${file} doesn't load: ${e?.message ?? e}`)
    console.log(JSON.stringify({ passed: 0, total: 1 }))
    process.exit(1)
  }
  const list = cases(mod)
  let passed = 0
  for (const [name, fn] of list) {
    try {
      await fn()
      passed++
    } catch (e) {
      console.log(`FAIL ${name}: ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}`)
    }
  }
  console.log(JSON.stringify({ passed, total: list.length }))
  process.exit(passed === list.length ? 0 : 1)
}
