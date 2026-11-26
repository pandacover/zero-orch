# UI overhaul: parity checklist

Every user-facing feature of the control plane before the overhaul (ui/app.js, app.css, index.html, web.js,
src/app/Api.ts, Model.ts, Threads.ts, Remote.ts, src/desktop/*), what it did, and where it lives in the new
design (prototypes/overhaul).

Status: `[x]` placed and checked headlessly; `[~]` placed, with a difference noted; `[-]` left out, with why.

Rule of thumb: the prototype decides look and layout; zero decides behaviour. Data the prototype shows that
zero didn't have is either built for real (said so) or left out (said so).

## Shell, window, phone

| | Feature | Before | Now |
|---|---|---|---|
| [x] | Sidebar toggle | Fixed button top left; remembered | `#side-toggle`, 8px in, centred on the top row; Ctrl B (new); remembered (`zero.sideHidden`) |
| [~] | Sidebar resize | Drag, arrows (Shift 48px), Home/End, double-click resets; 200–480px | Same handle and keys; prototype's range 208–420px (264 default). A narrowed window keeps the chosen width |
| [~] | Narrow sidebar | Overlay with scrim below 820px; a finger drags it in from the edge | Overlay with scrim below 640px (prototype); edge swipe kept; Esc closes it |
| [x] | Phone keyboard fit | `--app-h` from visualViewport | Kept on `.app` |
| [x] | Electron drag regions | Header rows drag; a no-drag span inside each row under the fixed toggles | `.drag` on the sidebar's top row, the header and the Changes head; `.nodrag-left/right` spans inside them under the toggles (checked as computed `-webkit-app-region`; not hit-tested in a window) |
| [x] | Windows window buttons | 45px rows; the right side clears them | `--head` and `--wco-w` from `env(titlebar-area-*)`: rows 45px, right toggles clear 138px; overlay colour = the new canvas (main.ts) |
| [x] | PWA | Manifest, icons, theme-color, Apple tags | Kept; theme-color follows the new canvas |
| [x] | Title count | `(n) zero` while threads need you | Kept: approvals and unseen ends |
| [~] | Toasts | Top layer; action toasts wait on hover; thread toasts clear when it opens; on phones at the top | Bottom right, 8px in, ≤280px, lift above the composer only where they'd cover it, re-placed as the dock grows; on phones too (prototype) |
| [x] | Tooltips | Own tips from `title`; keys as kbd; out from under window buttons | Kept, prototype look |
| [x] | Right-click / long press | Menu at the pointer; sheet on touch | Kept, `.pop` look; disabled items and key hints |
| [x] | Dialogs | Confirm/prompt with fields | Kept, `.dlg` look |
| [x] | Theme | System only | System by default. **New, real:** Settings › General › Appearance; in the desktop app it sets `nativeTheme.themeSource` (preload `zero.theme`) |
| [x] | Look | Blue accent, three display fonts | Monochrome tokens; amber/red/green only for meaning; one canvas; top-centre glow; Inter + Geist Mono (bundled, OFL) |

## Sidebar

| | Feature | Before | Now |
|---|---|---|---|
| [x] | Needs you | Approvals, errors, unseen ends | The inbox: approvals, then errors, then finished turns, then new threads and drafts; project · age, title, mark |
| [x] | Working | Section | "Working" row with count and pulse; Alt 2; a back arrow (Alt 1) returns |
| [x] | Settled | Seen threads went back under their project | "Settled" list (Alt 3). **Built for real:** `settled` on the thread (PATCH `settled`); hover action, Alt S, menu; a new message un-settles. A thread from before counts as settled once seen (`isSettled`), which is where it went before |
| [x] | Unseen | Bold + dot until open and in front; PATCH `seen` | Kept: bold title, dot mark |
| [x] | Drafts | Section of unsent words, discard | Inbox rows with the pencil mark (a settled thread too); a new thread's words get a row of their own; discard is the row's action and in its menu |
| [x] | Pinned | Pin/unpin; pinned first | Menu Pin/Unpin; first in each band; a pin glyph on the row |
| [x] | Threads started by threads | Indented under their starter | "↳ starter" in the row's first line; header chip; details card (From, Threads) |
| [x] | PR mark | `#n` coloured by state | `#n` in the row's first line; state in the tip |
| [~] | Row hover actions | Pin, delete | One action in the age's place: settle, stop (running or asking), bring back, or discard a draft. Pin and delete moved to the row's menu |
| [x] | Row menu | Pin, copy ID, delete, discard draft | Rename, settle/back, stop, pin, discard draft, copy branch, copy ID, open in VS Code / show folder (desktop), delete |
| [~] | Search | Sidebar box: titles, projects, message hits with snippets, jump to the item | In the Ctrl K palette: threads by title/project, "In messages" from the same search API with snippets, jumping to the item |
| [~] | Projects tree | By project, collapsible, + new thread, × remove, copy path | No tree (the inbox replaces it). **Settings › Projects** (new thread, copy path, remove, add); the new-thread page's project picker; the palette's "New thread in …"; the header's project segment starts one there. Collapse state is gone with the tree |
| [x] | Add project | Dialog (path, name, create, git init) | Same dialog, from the project picker, palette, Settings › Projects, first run, empty inbox |
| [x] | Footer | Evolution, Settings, Shortcuts | Same, prototype layout |
| [x] | Wordmark | Home | "zero": a new thread |

## Header and thread

| | Feature | Before | Now |
|---|---|---|---|
| [x] | Title rename | Always-editable input | The title opens the menu; F2 or double-click renames inline; menu Rename; `/rename` |
| [x] | Project in header | Click: new thread there | `project /`, click: new thread there |
| [x] | State pill | — | New: Working + clock (Compacting while it compacts), Needs approval, Error, Settled; from real state |
| [x] | Header links | From parent; N threads started | Kept as chips after the pill (hidden when the pane is narrow; also in the details card) |
| [x] | Open in VS Code / Show folder | Header icons (desktop) | Title menu and row menu (desktop) |
| [x] | Feed column | 780px | 720px; words on the composer's gutter; aligned with the composer at any width |
| [x] | Your message | Bubble; clamp; click to edit and resend; copy; files and @ chips; "from the agent in" | Same, prototype bubble |
| [x] | Answer | Markdown, code with Copy, copy row, turn details | Same |
| [x] | Quote on select | Quote button → `>` block | Kept |
| [~] | Tool calls | Rolling reel of the latest call; summary when done; calls open to output/diff | One summary line ("Read 2 files and ran 1 command") that opens to the calls (each to its output/diff); the running call is the group's last row with spinner, verb, target and clock. The rolling reel is gone |
| [x] | Answered approvals | "Allowed/Denied" lines | An allowed call carries "Allowed" / "Always allowed"; a denied one keeps a line |
| [x] | Worked fold | "Worked for 4m 12s" | Kept, summary-line look |
| [x] | Turn files | "Changed N files", Review in Git | Files-changed card, Review opens Changes on Code |
| [x] | Failed turn | Error line, Try again | Error card, Retry (same call) |
| [~] | Working line | Orbit glyph, "Working"/"Compacting", clock | Spinner, "Working", clock; only when no call runs and no compaction card runs |
| [x] | Memory cards, zero's follow-up, link cards | — | Kept, card/line look |
| [x] | Compaction card | Running/done/failed, "What Claude kept" | Kept (behaviour unchanged), prototype card |
| [x] | Show earlier, lazy turns, stick to bottom | — | Kept |
| [x] | Jump to latest | Round button | "Latest" pill above the dock |

## Composer and dock

| | Feature | Before | Now |
|---|---|---|---|
| [x] | Editor | contenteditable with inline chips | Kept, prototype box, send button inside |
| [x] | Send / Stop / Queue | — | Same; bare-icon button |
| [x] | Enter | Enter sends (not on touch) | Same. **New, real:** Settings › Send messages with Enter or Ctrl Enter |
| [x] | Prompt recall ↑/↓ | — | Kept |
| [x] | Attachments | Attach, paste, drop on the composer; 25 MB | Attach icon in the meta row; paste; drop anywhere on the thread (overlay) or where the caret goes in the box |
| [x] | @ picker, / commands | — | Kept; `/git` toggles Changes |
| [x] | Approvals | In the feed: Allow (Y), Deny (N) | Above the composer: Deny (N), Always allow, Allow (Y, Ctrl Enter in an empty box) |
| [x] | Always allow | — | **Built for real:** the same tool and command runs without asking for the rest of the thread (`alwaysAllow` on the thread); like asks waiting now are allowed too. Test: threads.test.ts |
| [-] | Answer with a reply | A message during an approval was queued | Zero's queue wins: it's queued, as before. The prototype's "reply instead" is left out |
| [x] | Queue | Rows with take-back; "After compaction" | Numbered tray above the composer: edit (take back) and, new, remove (the same DELETE without restoring); "After compaction" |
| [x] | Drafts kept per box | — | Kept |
| [x] | Model / effort / permissions | One chip, three columns | Meta row right: name, four-bar effort glyph, level; one-column popover with models by provider, effort as a segmented control, permissions with their meaning |
| [x] | Provider availability | Notes in the picker; composer disabled with why | Kept |
| [x] | Branch picker | Branches, remote, tags, new branch/worktree, join, leave, deferred worktree | Meta row left, same views |
| [x] | Compact switch | From 70% or an hour idle; per thread | Meta row switch; hidden while compacting |
| [x] | Context meter + usage limits | Ring, %, most pressing limit; words on hover | Ring and %, the pressing limit beside it; popover with the bar, tokens, every limit with its reset, Compact now (sends `/compact` when the provider takes it) |

## Changes panel (Git)

| | Feature | Before | Now |
|---|---|---|---|
| [x] | Toggle | "Git" + count + PR dot; Alt G | `#panel-toggle` icon; a dot when there's uncommitted work; Ctrl Alt B and Alt G; the tip names branch, changes, PR |
| [~] | Panel | Per thread, 300–680, remembered | Right column, 280–560 (prototype), remembered; overlays below 1100px; on a new thread it says what it will show |
| [x] | Tabs: Summary, Timeline, Code | — | Kept, segmented control; counts on Timeline and Code |
| [x] | Summary, Timeline, Code contents | Pull/push, PR, checks, re-run, ask the agent, More menu, comment, commit, write message, diffs, PR files | Kept |
| [x] | Auto-pull, not a repo | — | Kept |

## Thread details card (new)

| | Field | Source |
|---|---|---|
| [x] | Branch | `thread.branch` ("Not a git repository" once the panel has looked) |
| [x] | Folder | `workTree` / `cwd` / project folder |
| [x] | PR | `thread.pr` |
| [x] | From | **Built for real:** `origin` set when a thread is made: the window's are this machine (host name), remote access passes the paired device ("Safari on iPhone"), an agent's say so and link to the starter. Older threads: "Not recorded". Tests: api.test.ts, remote.test.ts, threads.test.ts |
| [x] | Threads | Threads this one started (opens the list) |
| [x] | Started | `createdAt` |
| [x] | Model · effort, Access | Thread |
| [x] | Cost | `sessionCostUsd` ("this session"); without it the sum of the turns' costs ("so far") |
| [x] | Toggle and layout | Ctrl I, left of Changes; Changes hides it, its toggle closes Changes; docks beside the column (which moves over) from 832px, over it below and closed there |

## Settings

| | Section | Now |
|---|---|---|
| [x] | General (new) | Appearance, Send messages with |
| [x] | Providers | Claude on/model/effort, Claude Code version and update; Codex and Ollama on with status, Codex CLI version |
| [x] | New threads | Default access, titles |
| [x] | Projects (new home for the tree's actions) | New thread, copy path, remove, add |
| [x] | Memory, Genome | Unchanged |
| [x] | Remote access | On, port, status, Tailscale states, Share on tailnet, manual command, QR pairing, codes, sign out every device |
| [x] | Storage | Paths |
| [-] | Notifications toggle | Left out: zero has no such setting; desktop notifications stay as they were (when unfocused) |

## Evolution

| | Feature | Now |
|---|---|---|
| [x] | Overview, History, Genome, Benchmark; run/stop, modes, reps, budget, discard, lineage, log, attempts | Kept whole; header row "Evolution"; tabs as a segmented control; prototype tokens |

## Keyboard

| | Key | Before | Now |
|---|---|---|---|
| [x] | Ctrl K | Palette | Palette (threads, message search, projects, actions) |
| [x] | Alt N | New thread | Same |
| [x] | Alt G | Git panel | Kept, a second key for Changes |
| [x] | Ctrl Alt B, Ctrl B, Ctrl I, Ctrl , | — | Changes, sidebar, details, Settings |
| [x] | Alt 1/2/3, Alt ↑/↓, Alt S, F2, / | — | Lists, previous/next thread, settle and go on, rename, focus the composer |
| [x] | ? | Shortcuts | Same, prototype sheet |
| [x] | Esc | Stops a running turn; clears a selection | Closes a menu or overlay first; then zero's: clears a selection, stops a running turn |
| [x] | Y / N | Allow / deny | Kept |
| [x] | Ctrl Enter | — | Allows the waiting approval when the box is empty; sends with "Send with Ctrl Enter" |

## Clashes resolved in zero's favour

- Esc: the prototype only closes things; zero stops a running turn. Esc closes an open menu or overlay first, then does what zero did.
- A message while an approval waits: zero queues it (kept); the prototype answered the approval with it.
- Ctrl B / Ctrl I in the composer are bold/italic in a contenteditable; the app's keys win (the composer sends plain text anyway).
- Ctrl Enter: allows only in an empty box, so "Send with Ctrl Enter" still sends.
- Alt G is kept beside Ctrl Alt B.
