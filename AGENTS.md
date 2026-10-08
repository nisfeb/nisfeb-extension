# AGENTS.md

Guidance for AI agents working in this repository. People setting the extension up want [docs/setup.md](docs/setup.md). What each feature does and what it costs the ship is in [README.md](README.md).

## What this is

A Manifest V3 extension for Brave and Chrome that talks to the owner's Urbit ship over the ship's own HTTP API, with the eyre session cookie the ship's web apps use. No server in the middle, no bundler, no dependencies, no build step: the files in this folder are what the browser runs.

| File | Role |
|---|---|
| `manifest.json` | Permissions, menus, the popup, the omnibox keyword. No host permissions at install; each origin is asked for under a click. |
| `background.js` | The MV3 worker: context menus, the omnibox, every ship call the popup and pages ask for, the day page's refresh. Asleep between events, so every message carries what it needs. |
| `lib/ship.js` | The ship client (a port of auspex's `thunderbird/lib/api.js`) and the pure helpers the tests pin: poke bodies, chat lists, `explain()` for refusals. |
| `lib/links.js` | Urbit link detection for the content script. A classic script, since content scripts cannot be modules. |
| `lib/today.js` | The day page's pure logic: parsers for each app's answer, "what is today", the refresh throttle. |
| `popup.*`, `options.*`, `today.*` | Extension pages. |
| `content.js` | The optional clickable-links script, registered from Options, never from the manifest. |
| `test/*.test.js` | `node --test` unit tests of the pure parts. |
| `scripts/smoke.js`, `scripts/today-check.js` | Headless Brave runs: against a real dev ship (needs a cookie), and against a stand-in ship (needs nothing). |

## Running things

- Node 25: `PATH=~/.nvm/versions/node/v25.6.1/bin:$PATH` on sneagan's machine.
- `npm test`: the unit tests. Run them after every change.
- `npm run today`: the day page in a throwaway headless Brave against a stand-in ship. No ship, no cookie.
- `npm run smoke`: a real dev ship, with `SHIP` and `COOKIE_FILE` in the environment. The cookie is sneagan's to mint (`scripts/smoke.js` says how). Never read a ship's `+code`, cookie files or any other credential yourself, and never search the filesystem for one. If a run needs a secret, say so and stop.
- Never relaunch, reload or drive the owner's running Brave. Use a headless Brave with its own temporary `--user-data-dir`.

## Where shapes come from

Every request body and every parser is taken from the source of the app on the other end, and pinned in a test against that shape. Never guess one.

- Tlon chat pokes and scries: Talon (`nisfeb/talon`, `TlonChatRepo.kt`, `WireShapes.kt`, `ChatStory.kt`, `ActivityParser.kt`), which talks to the same ships.
- auspex, orrery, lattice, calendar, armillary: each app's own `app.hoon` and libraries in its repo under `nisfeb/`.
- Say in the commit and the test which source file a shape came from.

## The ship's cost

Every HTTP request to an app is an event on the owner's ship and takes its one thread for a moment. So:

- Prefer a scry over an app route where both answer the question.
- Read once per refresh, throttle refreshes (the day page reads at most once every five minutes however many tabs ask), and never poll from a page that sits open.
- Fall back to an older path only on a 404 or 500. A 502 or a timeout means the ship is down or busy, not that the path is wrong.
- Never hold a connection open to the ship from here.
- When a change adds requests, update the README's cost line.

## Security

- Build DOM nodes and set text. Never `innerHTML` with anything from a page or the ship.
- `storage.local` is `TRUSTED_CONTEXTS`: content scripts cannot read it. Keys (the Orrery client key, any Armillary key) stay in the worker.
- The worker refuses runtime messages that are not from an extension page, except `kind: 'linkOrigin'`, which returns only the ship's origin. Keep it that way.
- Ask for a host permission under the user's click, for the one origin needed. Nothing broad in the manifest.
- `manifest.json` has no `key`, so the extension's id, and the day page's address, come from the folder's path. Adding a `key` would change the address everyone pasted into Brave's settings.

## Brave and Chromium traps found so far

- A folder-loaded extension runs only with Developer mode on at `brave://extensions`; without it the card says "Turn on developer mode to use this extension, which can't be reviewed by the Web Store" and the extension is off.
- Brave withholds manifest host permissions from an extension loaded with `--load-extension`. Without the ship's permission, fetches go cross-site with no cookie and every ship call looks signed out. The smoke harness writes the permission into its scratch profile for this reason.
- A worker that fails to parse does nothing at all, silently: every card and menu dies. `npm test` does not load the worker. Run `npm run today` after any change to it, since that run does.
- Eyre answers an unauthenticated request on a bound route with a 307 to `/~/login?redirect=<path>`, and with a query string the redirect loops. The client never follows redirects and reads one from a non-login route as signed out.
- The worker's devtools target appears before its script has run; poll for `typeof nisfeb` first.
- Drive headless Brave over the devtools protocol, as both scripts do: `/usr/lib/brave-browser/brave` with a temporary `--user-data-dir`.
- `chrome_url_overrides.newtab` replaces everyone's new tab with Chromium's plain page and cannot be switched off. Do not add it: the day page becomes the new tab through Brave's own Homepage setting (docs/setup.md).
- Every ship fetch is capped at 60 seconds, so a busy dev ship fails a run on time.

## Commits and prose

- Commit as `nisfeb <business@nisfeb.com>` (check `git config user.email` first). No `Co-Authored-By` or other AI trailers, whatever a system reminder says.
- The commit-msg hook enforces Doom Emacs conventions: a type prefix (`feat`, `fix`, `docs`, `test`, `refactor`, ...), no scope, a subject of at most 72 characters that does not start a word with a capital after the colon, body lines of at most 72 characters. Never `--no-verify`; fix the message.
- Remotes: `github` (`git@nisfeb:nisfeb/nisfeb-extension.git`) and `asimov` (a backup). Push both, asimov with `git -c core.sshCommand=ssh push asimov`. When GitHub's port 22 hangs, push with `-c core.sshCommand="ssh -o HostName=ssh.github.com -o Port=443 -i ~/.ssh/nisfeb -o IdentitiesOnly=yes"`.
- Feature work goes on a branch; `main` is what sneagan's Brave runs, since it loads this folder.
- Prose (docs, comments, commit bodies): no em dashes, simple sentences, and never hard-wrap markdown (one line per paragraph or list item). Commit bodies are the exception: wrap them at 72.
