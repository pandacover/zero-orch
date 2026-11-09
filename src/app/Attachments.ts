/**
 * Files a person attaches to a message: pasted into the composer or picked
 * with its Attach button.
 *
 * The page uploads each file as soon as it lands in the composer; it's kept
 * under `<home>/attachments/<id>/<name>`. A message's text holds a marker,
 * `{{att:<id>}}`, where the file sits among the words. The page draws the
 * marker as a chip; the agent gets the file's name and path in its place and
 * reads the file itself (Claude's Read takes images too).
 */
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"
import type { Thread } from "./Model.ts"

export interface Attachment {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly size: number
  readonly mime: string
}

/** Biggest file the composer takes. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

const ID = /^att_[a-z0-9]{6,32}$/
export const isAttachmentId = (x: unknown): x is string => typeof x === "string" && ID.test(x)

export const MARKER = /\{\{att:(att_[a-z0-9]{6,32})\}\}/g
export const marker = (id: string): string => `{{att:${id}}}`

/** The ids a message's text refers to, each once, in order. */
export const markersIn = (text: string): Array<string> => [...new Set([...text.matchAll(MARKER)].map((m) => m[1]!))]

const MIMES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv"
}
export const mimeOf = (name: string): string => MIMES[extname(name).toLowerCase()] ?? "application/octet-stream"

/** Raster images a browser may show inline; anything else (SVG included) is served as a download. */
export const isInlineImage = (mime: string): boolean => /^image\/(png|jpeg|gif|webp|bmp)$/.test(mime)

/**
 * A name safe to keep on disk: no folders, no `..`, nothing Windows refuses,
 * at most 120 characters with the extension kept. A pasted screenshot comes
 * without a useful name; it gets `pasted.png`.
 */
export const safeName = (raw: string, mime = ""): string => {
  const base = raw.split(/[\\/]/).pop() ?? ""
  let name = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .replace(/\s+/g, " ")
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = `_${name}`
  if (!name) {
    const ext = Object.entries(MIMES).find(([, m]) => m === mime)?.[0] ?? ""
    name = `pasted${ext}`
  }
  if (name.length > 120) {
    const ext = extname(name).slice(0, 16)
    name = `${name.slice(0, 120 - ext.length)}${ext}`
  }
  return name
}

const newAttachmentId = (): string => `att_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`

/** Keep an uploaded file. */
export const saveAttachment = (home: string, rawName: string, mime: string, bytes: Buffer): Attachment => {
  const id = newAttachmentId()
  const name = safeName(rawName, mime)
  const dir = join(home, "attachments", id)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return { id, name, path, size: bytes.length, mime: mimeOf(name) }
}

/** A kept file by id, or undefined when there's none. */
export const findAttachment = (home: string, id: string): Attachment | undefined => {
  if (!isAttachmentId(id)) return undefined
  const dir = join(home, "attachments", id)
  if (!existsSync(dir)) return undefined
  const name = readdirSync(dir)[0]
  if (!name) return undefined
  const path = join(dir, name)
  return { id, name, path, size: statSync(path).size, mime: mimeOf(name) }
}

const byId = (attachments: ReadonlyArray<Attachment>) => new Map(attachments.map((a) => [a.id, a]))

/** The message as words: each marker becomes the file's name. For titles and memory recall. */
export const plainText = (text: string, attachments: ReadonlyArray<Attachment> = []): string => {
  const known = byId(attachments)
  return text.replace(MARKER, (_, id: string) => known.get(id)?.name ?? "a file")
}

/** The message as the agent gets it: each marker becomes the file's name and where it is. */
export const promptText = (text: string, attachments: ReadonlyArray<Attachment> = []): string => {
  if (attachments.length === 0) return text
  const known = byId(attachments)
  const body = text.replace(MARKER, (_, id: string) => {
    const a = known.get(id)
    return a ? `[attached file "${a.name}" at ${a.path}]` : "[a file that is no longer attached]"
  })
  return `${body}\n\n(The person attached ${attachments.length === 1 ? "a file" : `${attachments.length} files`} to this message. Each is saved at the path shown; open it from there to see it, images included.)`
}

/** Delete the files a thread's messages carried, when the thread goes. */
export const removeAttachments = (home: string, thread: Thread | undefined): void => {
  for (const item of thread?.items ?? []) {
    if (item.kind !== "user") continue
    // By id under home, never by the stored path: a thread file can't point this anywhere else.
    for (const a of item.attachments ?? []) {
      if (isAttachmentId(a.id)) rmSync(join(home, "attachments", a.id), { recursive: true, force: true })
    }
  }
}
