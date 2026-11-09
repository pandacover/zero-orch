import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  type Attachment,
  findAttachment,
  isInlineImage,
  marker,
  markersIn,
  plainText,
  promptText,
  removeAttachments,
  safeName,
  saveAttachment
} from "../src/app/Attachments.ts"

const shot: Attachment = { id: "att_abc123def", name: "screen.png", path: "C:\\z\\attachments\\att_abc123def\\screen.png", size: 10, mime: "image/png" }
const notes: Attachment = { id: "att_xyz789uvw", name: "notes.md", path: "/z/attachments/att_xyz789uvw/notes.md", size: 4, mime: "text/markdown" }

describe("attachment markers", () => {
  it("finds each file a message marks, once and in order", () => {
    const text = `Look at ${marker(shot.id)} and ${marker(notes.id)}, then ${marker(shot.id)} again`
    expect(markersIn(text)).toEqual([shot.id, notes.id])
    expect(markersIn("no files here {{att:../etc}} {{att:ATT_UPPER1}}")).toEqual([])
  })

  it("names each file in place of its marker for titles and memory", () => {
    expect(plainText(`Fix ${marker(shot.id)} please`, [shot])).toBe("Fix screen.png please")
    expect(plainText(`Fix ${marker("att_gone12345")}`, [])).toBe("Fix a file")
  })

  it("hands the agent each file's name and path, and says how to read them", () => {
    const p = promptText(`Why does ${marker(shot.id)} look off?`, [shot])
    expect(p).toContain(`[attached file "screen.png" at ${shot.path}]`)
    expect(p).toMatch(/attached a file to this message/)
    expect(p).toMatch(/open it from there/)
    expect(promptText(`${marker(shot.id)}${marker(notes.id)}`, [shot, notes])).toMatch(/attached 2 files/)
    expect(promptText("plain text", [])).toBe("plain text")
  })
})

describe("attachment names", () => {
  it("keeps the name and nothing that leaves the folder", () => {
    expect(safeName("report.pdf")).toBe("report.pdf")
    expect(safeName("../../etc/passwd")).toBe("passwd")
    expect(safeName("C:\\Users\\x\\secret.txt")).toBe("secret.txt")
    expect(safeName("..")).toBe("pasted")
    expect(safeName('a<b>:c"d|e?f*.txt')).toBe("a_b__c_d_e_f_.txt")
    expect(safeName("CON.txt")).toBe("_CON.txt")
  })

  it("names a pasted image without a name by its type", () => {
    expect(safeName("", "image/png")).toBe("pasted.png")
    expect(safeName("", "")).toBe("pasted")
  })

  it("cuts a long name and keeps its extension", () => {
    const name = safeName(`${"x".repeat(300)}.png`)
    expect(name.length).toBe(120)
    expect(name.endsWith(".png")).toBe(true)
  })

  it("shows only raster images inline; SVG downloads", () => {
    expect(isInlineImage("image/png")).toBe(true)
    expect(isInlineImage("image/svg+xml")).toBe(false)
    expect(isInlineImage("text/html")).toBe(false)
  })
})

describe("attachment files", () => {
  const home = mkdtempSync(join(tmpdir(), "zero-att-"))
  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it("keeps an upload and finds it again by id", () => {
    const saved = saveAttachment(home, "../shot.png", "image/png", Buffer.from("png-bytes"))
    expect(saved.name).toBe("shot.png")
    expect(dirname(saved.path)).toBe(join(home, "attachments", saved.id))
    expect(readFileSync(saved.path, "utf8")).toBe("png-bytes")
    expect(findAttachment(home, saved.id)).toEqual(saved)
  })

  it("deletes a thread's files with it, by id under home only", () => {
    const kept = saveAttachment(home, "a.txt", "text/plain", Buffer.from("a"))
    const other = saveAttachment(home, "b.txt", "text/plain", Buffer.from("b"))
    const thread = {
      items: [
        { kind: "user", id: "u1", at: "", text: marker(kept.id), attachments: [{ ...kept, path: "/somewhere/else/entirely" }] },
        { kind: "assistant", id: "a1", at: "", text: "ok" }
      ]
    } as unknown as Parameters<typeof removeAttachments>[1]
    removeAttachments(home, thread)
    expect(findAttachment(home, kept.id)).toBeUndefined()
    expect(findAttachment(home, other.id)).toEqual(other)
    removeAttachments(home, undefined)
  })

  it("finds nothing for an unknown or malformed id", () => {
    expect(findAttachment(home, "att_nothere123")).toBeUndefined()
    expect(findAttachment(home, "../settings")).toBeUndefined()
  })
})
