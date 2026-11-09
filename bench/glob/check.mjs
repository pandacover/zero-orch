import assert from "node:assert/strict"
import { suite } from "../_lib/suite.mjs"

await suite("solution.mjs", ({ match }) => {
  const yes = (p, ...paths) => { for (const x of paths) assert.equal(match(p, x), true, `${p} should match ${x}`) }
  const no = (p, ...paths) => { for (const x of paths) assert.equal(match(p, x), false, `${p} shouldn't match ${x}`) }
  return [
    ["star", () => { yes("*.js", "a.js", "abc.js"); no("*.js", "a/b.js", "a.ts", "js"); yes("a*", "a", "abc") }],
    ["question", () => { yes("a?c", "abc", "a-c"); no("a?c", "ac", "a/c", "abbc") }],
    ["whole path", () => { no("a", "ab", "ba"); yes("a/b", "a/b"); no("a/b", "a/b/c") }],
    ["globstar", () => { yes("**/*.js", "a.js", "x/y/a.js"); yes("a/**/b", "a/b", "a/x/y/b"); yes("**", "a", "a/b/c") }],
    ["trailing globstar", () => { yes("src/**", "src/a", "src/a/b"); no("src/**", "src", "srcx/a") }],
    ["classes", () => { yes("[a-c]x", "bx", "ax"); no("[a-c]x", "dx"); yes("[!a-c]x", "dx", "zx"); no("[!a-c]x", "ax"); yes("[xyz]", "y"); no("a[!b]c", "a/c") }],
    ["braces", () => { yes("{a,b}.txt", "a.txt", "b.txt"); no("{a,b}.txt", "c.txt"); yes("{a,{b,c}d}", "a", "bd", "cd"); no("{a,{b,c}d}", "b", "ad"); yes("src/{*.ts,lib/**}", "src/x.ts", "src/lib/a/b") }],
    ["escapes", () => { yes("\\*.md", "*.md"); no("\\*.md", "x.md"); yes("a\\?", "a?"); no("a\\?", "ab") }],
    ["dot files", () => { no("*.js", ".a.js"); no("*", ".bashrc"); no("?bashrc", ".bashrc"); no("[.]x", ".x"); yes(".*rc", ".bashrc"); yes("a/.*", "a/.env") }],
    ["dot dirs under globstar", () => { no("**/x", ".git/x", "a/.h/x"); no("**", ".a", "a/.b"); no("a/**", "a/.git/config"); yes("**/.env", ".env", "a/.env") }]
  ]
})
