import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/** ui/app.js is a page script, not a module: run its esc() and markdown section on their own. */
const { md } = ((): { md: (src: string) => string } => {
  const src = readFileSync(new URL("../ui/app.js", import.meta.url), "utf8")
  const esc = src.match(/^const esc = .*$/m)?.[0]
  const start = src.indexOf("// ---------- markdown")
  const end = src.indexOf("function mdNodes(")
  if (!esc || start < 0 || end < start) throw new Error("ui/app.js: markdown section not found")
  return new Function(`${esc}\n${src.slice(start, end)}\nreturn { md }`)()
})()

const BS = "\\"
const link = (href: string, label = href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`

describe("markdown", () => {
  it("renders tables, with alignment, code holding a pipe and ragged rows", () => {
    expect(md("| a | b |\n|:--|--:|\n| 1 | 2 |")).toBe(
      '<div class="table-wrap"><table><thead><tr><th class="al-left">a</th><th class="al-right">b</th></tr></thead>' +
      '<tbody><tr><td class="al-left">1</td><td class="al-right">2</td></tr></tbody></table></div>')
    expect(md(`Here:\na | b\n--- | ---\n\`x|y\` | ${BS}|\n| only |`)).toBe(
      "<p>Here:</p><div class=\"table-wrap\"><table><thead><tr><th>a</th><th>b</th></tr></thead>" +
      "<tbody><tr><td><code>x|y</code></td><td>|</td></tr><tr><td>only</td><td></td></tr></tbody></table></div>")
    expect(md("a | b\nno separator")).toBe("<p>a | b<br>no separator</p>")
  })

  it("nests lists and reads task, numbered and loose lists", () => {
    expect(md("- one\n  - two\n    - three\n- four")).toBe("<ul><li>one<ul><li>two<ul><li>three</li></ul></li></ul></li><li>four</li></ul>")
    expect(md("1. a\n  - b\n2. c")).toBe("<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>")
    expect(md("- [ ] todo\n- [x] done")).toBe('<ul><li class="task"><input type="checkbox" disabled> todo</li><li class="task"><input type="checkbox" disabled checked> done</li></ul>')
    expect(md("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>')
    expect(md("- a\n\n- b")).toBe("<ul><li><p>a</p></li><li><p>b</p></li></ul>")
    expect(md("1. Run\n\n   ```sh\n   npm test\n   ```\n2. Next")).toContain("<li><p>Run</p><div class=\"code\">")
  })

  it("renders every heading level, setext headings and all three rules", () => {
    expect(md("#### Four\n###### Six ##")).toBe("<h4>Four</h4><h6>Six</h6>")
    expect(md("Title\n=====\n\nSub\n---")).toBe("<h1>Title</h1><h2>Sub</h2>")
    expect(md("***\n\n___\n\n- - -")).toBe("<hr><hr><hr>")
    expect(md("#hashtag")).toBe("<p>#hashtag</p>")
  })

  it("reads ~~~ and longer fences, and an unclosed fence while it streams", () => {
    expect(md("~~~js\nx\n~~~")).toContain("<span>js</span>")
    expect(md("````md\n```js\nx\n```\n````")).toContain("<pre><code>```js\nx\n```</code></pre>")
    expect(md("text\n```ts\nconst x = 1")).toContain("<pre><code>const x = 1</code></pre>")
    expect(md("```inline``` here")).toBe("<p><code>inline</code> here</p>")
  })

  it("renders inline emphasis, strikethrough, escapes and code spans", () => {
    expect(md("__b__ _i_ ***bi*** ~~gone~~ snake_case_name 2 * 3 * 4")).toBe(
      "<p><strong>b</strong> <em>i</em> <strong><em>bi</em></strong> <del>gone</del> snake_case_name 2 * 3 * 4</p>")
    expect(md(`${BS}*not em${BS}* C:${BS}Users`)).toBe(`<p>*not em* C:${BS}Users</p>`)
    expect(md("`**raw**` and ``a ` b``")).toBe("<p><code>**raw**</code> and <code>a ` b</code></p>")
  })

  it("links bare URLs and autolinks, trimming trailing punctuation", () => {
    expect(md("see https://a.com/x. and <https://b.com>")).toBe(`<p>see ${link("https://a.com/x")}. and ${link("https://b.com")}</p>`)
    expect(md("(https://w.org/Foo_(bar))")).toBe(`<p>(${link("https://w.org/Foo_(bar)")})</p>`)
    expect(md("![alt](https://x.dev/y.png)")).toBe(`<p>${link("https://x.dev/y.png", "alt")}</p>`)
  })

  it("lets no markup or script through", () => {
    expect(md("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")
    expect(md("[x](javascript:alert(1))")).toBe("<p>x</p>")
    expect(md('https://a.com/"onmouseover="x')).toBe(`<p>${link("https://a.com/")}&quot;onmouseover=&quot;x</p>`)
    expect(md('[ok](https://a.com/?a=1&b="2")')).toBe(`<p>${link("https://a.com/?a=1&amp;b=&quot;2&quot;", "ok")}</p>`)
  })
})
