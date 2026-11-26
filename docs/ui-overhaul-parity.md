# UI overhaul: parity checklist

Every user-facing feature of the control plane before the overhaul (ui/app.js, app.css, index.html, web.js,
src/app/Api.ts, Model.ts, Threads.ts, Remote.ts, src/desktop/*), what it does today, and where it lives in the
new design (prototypes/overhaul). Status: `[x]` placed and checked, `[~]` placed with a difference noted,
`[ ]` not done.

Rule of thumb: the prototype decides look and layout; zero decides behaviour. Data the prototype shows that
zero didn't have is either built for real (said so) or left out (said so).

## Shell, window, phone

| | Feature | Today | New design |
|---|---|---|---|
| [ ] | Sidebar toggle | Fixed button top-left, Ctrl B not bound; slides, remembered (`zero.sideHidden`) | `.tgl-left` fixed 8px in, centred on the top row; Ctrl B; remembered |
| [ ] | Sidebar resize | Drag edge, arrows (Shift = 48px), Home/End, double-click resets; 200–480px | Same handle (`.resize-left`), 208–420px, double-click resets, arrows |
| [ ] | Narrow (<820px) sidebar | Overlays with scrim; finger drags it in from the left edge and back | Below 640px overlays with scrim (prototype breakpoint); edge-swipe kept |
| [ ] | Phone keyboard fit | `--app-h` from visualViewport; Safari keyboard handling | Kept on the new `.app` grid |
| [ ] | Electron drag regions | Header rows drag; a `toggle-spot` inside the drag row keeps the fixed toggle clickable | `.drag` on side-top, head, panel-head; no-drag spots inside them under every fixed toggle |
| [ ] | Windows window controls | Overlay 45px; page clears 138px at the top right; tips move out from under them | `.wco` class from `navigator.windowControlsOverlay`; `--head: 45px; --wco-w: 138px`; overlay colour = new canvas |
| [ ] | PWA | manifest, icons, theme-color, apple tags | Kept; theme-color follows the new canvas |
| [ ] | Title count | `(n) zero` while threads need you | Kept (inbox count of approvals, errors, unseen finishes) |
| [ ] | Toasts | Top-layer popover; action toasts wait on hover; thread toasts clear when the thread opens | Bottom-right, 8px in, ≤280px; lift above the composer only where they'd cover it; same behaviour |
| [ ] | Tooltips | Own tips from `title`, delay then warm, keys drawn as kbd, kept out from under window buttons | Prototype tip style; same mechanism |
| [ ] | Right-click / long-press menus | Context menu at pointer; sheet on touch | `.pop` menu at the pointer; sheet on touch kept |
| [ ] | Dialogs | Confirm/prompt `<dialog>` with fields | `.dlg` style, same flows |
| [ ] | Theme | Follows the OS only | Follows the OS by default; Settings › Appearance (System/Light/Dark) is new, real (local), and in the desktop app sets `nativeTheme.themeSource` so the window buttons match |
| [ ] | Glow, one background, fonts | Plain background; Bricolage/Hanken/Martian | Top-centre glow; sidebars and thread share the canvas; Inter + Geist Mono (bundled, OFL) |

## Sidebar

| | Feature | Today | New design |
|---|---|---|---|
| [ ] | Needs you | Section: approvals, errors, unseen finishes, sorted by that then age | The inbox: approvals, errors, finished turns, then new/draft; project · age, title, mark |
| [ ] | Working | Section of running threads | "Working" row with count + pulse; switches the list (Alt 2); back arrow returns |
| [ ] | Projects tree | Threads by project, collapsible, + new thread, × remove, right-click (new, copy path, remove) | Replaced by the inbox + Settled list; project management moves to Settings › Projects (add, remove, copy path, new thread) and the new-thread project picker; Ctrl K lists projects |
| [ ] | Settled / seen | Seen threads drop back under their project | "Settled" list (Alt 3). **Built for real**: `settled` on the thread; settle by hover action, Alt S, menu; a new message un-settles. Threads from before the overhaul count as settled once seen, as they left Needs you before |
| [ ] | Unseen | Bold + dot until the thread is open with zero in front; PATCH `seen` | Kept: unread rows bold with a dot mark; same PATCH |
| [ ] | Drafts | Section of unsent words (replies and new threads), discard | Inbox rows with the pencil mark; new-thread drafts are rows of their own; discard from the hover action / menu |
| [ ] | Pinned | Pin/unpin on hover and menu; pinned first | Menu Pin/Unpin; pinned first in each list, a pin glyph on the row |
| [ ] | Threads started by threads | Indented under their starter, link mark | Project line says "↳ <starter>"; details card links both ways; header chip |
| [ ] | PR mark | `#n` coloured by state after the title | `#n` in the row's project line (monochrome, state in the tip) |
| [ ] | Row hover actions | Pin, delete | One action in the age's place: settle, stop, bring back (or discard a draft); the rest in the right-click menu |
| [ ] | Row menu | Pin, copy ID, delete (+ discard draft) | Rename, settle/back, stop, pin, copy branch, copy ID, open folder/VS Code (desktop), discard draft, delete |
| [ ] | Search | Box: titles + project names, then message hits with snippets (FTS), jump to the item | Ctrl K palette: threads by title/project, then "In messages" hits from the same search API, jumping to the item |
| [ ] | Add project | Folder icon → dialog (path, name, create, git init) | Palette "Add project…", project picker "Add project…", Settings › Projects, first-run page |
| [ ] | Footer | Evolution link, Settings, Shortcuts | Same, prototype layout |
| [ ] | Wordmark | Home link | "zero" wordmark: a new thread |

## Header and thread

| | Feature | Today | New design |
|---|---|---|---|
| [ ] | Title rename | Always-editable input | Title button opens the menu; F2 / double-click renames inline; menu Rename; `/rename` |
| [ ] | Project in header | Click: new thread in it | `project /` segment, click: new thread in it |
| [ ] | State pill | — (working line only) | New pill: Working + clock, Needs approval, Error, Settled — from real state |
| [ ] | Header links | Chips: from parent, N threads started | Kept after the pill, prototype chip style |
| [ ] | Open in VS Code / Show folder | Header icons (desktop) | Title menu items (desktop) |
| [ ] | Feed column | 780px | 720px column, words on the composer's gutter |
| [ ] | User message | Bubble; clamp + Show more; click to edit and resend; copy; files and @mentions as chips; "from the agent in" | Same, prototype bubble |
| [ ] | Assistant message | Markdown, code blocks with Copy, copy row, turn meta (model, time, cost, tokens) | Same, prototype type |
| [ ] | Quote on select | Quote button over a selection → `>` block in the composer | Kept |
| [ ] | Tool calls | Runs fold to a row; reel of the latest call; summary "Read 7 files, ran 3 commands"; each call opens to output/diff | Summary line "Read 3 files and ran 1 command" with chevron; the running tool is the group's last row (spinner, verb, target, clock); calls open to output/diff as before |
| [ ] | Answered approvals | "Allowed/Denied" lines folded in the run | An allowed call carries an "Allowed"/"Always allowed" tag; denied keeps a line |
| [ ] | Worked fold | Finished turn's work folds into "Worked for 4m 12s" | Kept, prototype summary style |
| [ ] | Turn files | "Changed N files +a −d", Review in Git | Files-changed card with Review (opens Changes on Code) |
| [ ] | Failed turn | Error line + Try again on the last turn | Error card with Retry (same call) |
| [ ] | Working line | Glyph + "Working"/"Compacting" + clock | Standalone only when no tool runs (and no compaction card runs) |
| [ ] | Memory cards | Recalled/checked/stored, agent recall | Kept, card style |
| [ ] | Link cards | Started/messaged/waited, live state, reply | Kept, card style |
| [ ] | zero follow-up | "zero sent it on" line | Kept |
| [ ] | Compaction card | Running bar/clock, done facts + "What Claude kept", failed | Kept, behaviour unchanged, prototype card |
| [ ] | Show earlier / lazy turns | Batches of 60 entries; observer | Kept |
| [ ] | Jump to latest | Button when scrolled up; "fresh" when new | Prototype "New messages" pill above the dock |
| [ ] | Stick to bottom | Follows unless the person scrolled | Kept |

## Composer and dock

| | Feature | Today | New design |
|---|---|---|---|
| [ ] | Editor | contenteditable with inline file and @ chips | Kept, in the prototype box; send button bare icon inside |
| [ ] | Send / Stop / Queue | Stop when working and empty; Queue while working | Same; bare icon button |
| [ ] | Enter | Enter sends (not on touch); Shift Enter newline | Kept; Settings › "Send messages with" Enter or Ctrl Enter is new, real (local) |
| [ ] | Prompt recall | ↑/↓ in an empty box | Kept |
| [ ] | Attachments | Attach, paste, drop on the composer; upload, 25 MB; thumbnails | Attach icon in the meta row; paste; drop anywhere on the thread (prototype overlay) lands in the composer |
| [ ] | @ file picker | Files and folders, browse with Tab | Kept, `.pop` look |
| [ ] | / commands | compact, git, rename, new + the session's commands | Kept (`/git` toggles Changes) |
| [ ] | Approvals | Card in the feed: Allow (Y), Deny (N) | Card above the composer: Deny, Always allow, Allow (Ctrl Enter, Y); N denies |
| [ ] | Always allow | — | **Built for real**: the same tool + command is allowed without asking for the rest of the thread (kept on the thread) |
| [ ] | Answer with a reply | A message sent while an approval waits is queued | Zero's queue wins: it stays queued (placeholder says so). Prototype's "reply instead" left out |
| [ ] | Queue tray | Queued messages with take-back (to composer); "After compaction" row | `.queue` tray above the composer: numbered, edit (take back), "After compaction" |
| [ ] | Drafts kept | Per box, with chips | Kept |
| [ ] | Model / effort / permissions | One chip: provider-grouped models, effort, access | Meta row right: model name + four-bar effort glyph + level name; popover with Model (by provider), Effort, Permissions |
| [ ] | Provider availability | Off providers' groups say why; composer disabled when the provider is off | Kept in the popover and placeholder |
| [ ] | Branch picker | Branches, remote, tags (default, worktree, gone, ahead/behind), new branch / new worktree forms, join, leave, deferred worktree for new threads | Meta row left, `#branch` popover; same views |
| [ ] | Compact switch | From 70% or an hour idle, on by default, per thread | Meta row, prototype switch |
| [ ] | Context meter | Ring + %, usage limits in words, tip | `#context` ring + %; popover with the bar, tokens, limits, Compact now |
| [ ] | Usage limits | Most pressing beside the ring | Beside the % in the meter, all of them in the popover |

## Changes panel (Git)

| | Feature | Today | New design |
|---|---|---|---|
| [ ] | Toggle | Fixed top right, "Git" + count + PR dot; Alt G | `.tgl-right` icon, dot when uncommitted; Ctrl Alt B (Alt G kept) |
| [ ] | Panel | Per thread, resizable 300–680, remembered open/tab/width | Right column, 280–560, overlays below 1100px |
| [ ] | Tabs | Summary, Timeline, Code | Kept, prototype segmented control |
| [ ] | Summary | Branch vs upstream, pull/push, PR head, checks (re-run, ask the agent), description, More menu (GitHub, ready/draft, edit, reviewers, update, reopen, new PR, ask agent to open/rebase, fetch, auto-pull, close) | Kept |
| [ ] | Timeline | Commits + PR notes, comment box | Kept |
| [ ] | Code | Uncommitted with diffs, commit message, Write message, Commit; PR files | Kept, `.frow` rows, `.diff` |
| [ ] | Auto-pull | Fetch every 3 min, fast-forward when safe | Kept |
| [ ] | Not a repo | Says so | Kept |

## Thread details card (new)

| | Field | Source |
|---|---|---|
| [ ] | Branch | `thread.branch` / git |
| [ ] | Folder | worktree (`workTree`/`cwd`) or project folder |
| [ ] | PR | `thread.pr` |
| [ ] | From (device) | **Built for real**: `origin` recorded at creation: this machine (hostname) from the window, the paired device's name over remote access, "Another thread" for agent-started ones; older threads say "Not recorded" |
| [ ] | Started | `createdAt` |
| [ ] | Model · effort | thread |
| [ ] | Access | thread |
| [ ] | Cost | `sessionCostUsd` (the provider's running total for the session); without one, the sum of the turns' costs |
| [ ] | Toggle and layout | Ctrl I, left of Changes; Changes hides it; docks beside the column where there's room, over it below 832px (starts closed there) |

## Settings

| | Section | Today | New design |
|---|---|---|---|
| [ ] | Providers | Claude on, model, effort, Claude Code version/update; Codex, Ollama on + status; Codex version | Kept in the new dialog |
| [ ] | New threads | Default access, titles auto + model | Kept |
| [ ] | Memory | Recall, store | Kept |
| [ ] | Genome | Use evolved instructions | Kept |
| [ ] | Remote access | On, port, status, Tailscale states, Share on tailnet, manual command, QR pairing, codes, sign out devices | Kept |
| [ ] | Storage | Paths | Kept |
| [ ] | Appearance, Send with | — | New, real (local) |
| [ ] | Projects | (sidebar) | New section: list, add, remove, copy path, new thread |
| [ ] | Notifications toggle | — (desktop notifications always on when unfocused) | Left out: zero has no such setting |

## Evolution

| | Feature | New design |
|---|---|---|
| [ ] | Overview, History, Genome, Benchmark tabs; run/stop, modes, reps, budget, discard, lineage chart, log, attempts | Kept whole, restyled (prototype tokens, `.page`) |

## Keyboard

| | Key | Today | New |
|---|---|---|---|
| [ ] | Ctrl K | Palette | Palette (threads, projects, actions, message search) |
| [ ] | Alt N | New thread | Same |
| [ ] | Alt G | Git panel | Kept as a second key for Changes |
| [ ] | Ctrl Alt B | — | Changes |
| [ ] | Ctrl B | — | Sidebar |
| [ ] | Ctrl I | — | Details card |
| [ ] | Ctrl , | — | Settings |
| [ ] | Alt 1/2/3 | — | Inbox, Working, Settled |
| [ ] | Alt ↑/↓ | — | Previous/next thread in the list |
| [ ] | Alt S | — | Settle and go to the next |
| [ ] | F2 | — | Rename |
| [ ] | ? | Shortcuts | Same |
| [ ] | / | — | Focus the composer (outside a text field) |
| [ ] | Esc | Stops a running turn; clears a selection | Closes a menu/overlay first; otherwise zero's: stops the turn |
| [ ] | Y / N | Allow / deny | Kept |
| [ ] | Ctrl Enter | — | Allow the waiting approval when the box is empty (sends when "Send with Ctrl Enter") |

## Clashes resolved in zero's favour

- Esc: the prototype only closes things; zero stops a running turn. Esc closes an open menu or overlay first, then stops the turn.
- Answering an approval with a message: zero queues it; kept.
- Ctrl Enter: allows only when the box is empty, so "Send with Ctrl Enter" still sends.
