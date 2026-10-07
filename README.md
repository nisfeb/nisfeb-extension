# Nisfeb for Brave and Chrome

Your Urbit ship from any page. One extension for the nisfeb apps that run on the ship: [auspex](https://github.com/nisfeb/auspex) (mail), [orrery](https://github.com/nisfeb/orrery) (a model of your world), [lattice](https://github.com/nisfeb/lattice) (pages and knowledge), [calendar](https://github.com/nisfeb/calendar) and [armillary](https://github.com/nisfeb/armillary) (inference), plus Tlon's chat. It talks to each over the ship's own HTTP API with the session cookie the ship's web apps use. There is no server in the middle and no account but the ship.

## Install

Load it unpacked: **brave://extensions**, turn on Developer mode, **Load unpacked**, pick this directory. Then open its **Options** page and give it two things: the ship's URL and its `+code`.

Connect asks the browser for permission to talk to that one origin (the manifest asks for nothing at install), then POSTs the code to `/~/login`, eyre's own login form. The answer sets the session cookie for that origin and the browser's cookie jar keeps it. **The code is used once and never stored.** A ship restart invalidates the cookie, and any 403 after that flips the status to signed out: connect again.

## What it does

Right-click a page, a selection or a link, or press **Alt+Shift+U** (or click the toolbar button) for the popup, which opens with the page's title, address and selection already in every card.

| | on the ship |
|---|---|
| **Send to Auspex** | the selection and the address as the body, the title as the subject, ships in To. **Send** posts `/apps/auspex/api/send`. **Edit in Auspex** saves it as a draft and opens the web client, whose composer has the contacts, the attachments and the rest. |
| **Send to a chat** | the page's title and address, with the selection quoted above them, as a message in a DM, a group DM or a group's chat channel, sent as you. The message is yours to edit first. The chat is picked by name from the ship's own list (`/~/scry/chat/dm`, `/~/scry/chat/clubs` and `/~/scry/groups/v3/groups`, the scries Talon reads), with the ones picked here last at the top; a ship can also be typed. The send is the poke Talon sends, `chat-dm-action-2` or `chat-club-action-2` to `%chat` or `channel-action-2` to `%channels`, on an eyre channel opened for it, and the card waits up to 15 seconds for the agent's answer: sent, refused (in the agent's words), or not confirmed, which means it may still land. |
| **Read in Orrery** | the selection, or the page's readable text when nothing is selected, handed to the ship's read channel, `POST /apps/orrery/api/read`, with the page as the source of every fact. The ship reads it as it reads a message: gate, extraction, grounding, filing, then proposals. The answer is immediate and the reading happens afterwards; the facts appear on the bodies the page names and proposals in your inbox. A page is sent once; sending it again is a second click. Needs orrery 59 or later. With an Orrery client key in Options the request is the key's (`Authorization: Bearer`, no cookie), so the facts carry the extension's own name and the key's scope bounds them; without one it is yours. |
| **Save selection to Lattice** | a private markdown page under `clips/`, `POST /apps/lattice/page-save`, with the title, the source and the date at the top and the selection quoted under them. |
| **Bookmark in Lattice** | `POST /apps/lattice/bookmark`: the ship's own browser bookmarks, the list its home page and address bar read. |
| **Archive page in Lattice** | the page as the browser holds it, `POST /apps/lattice/clip-html`, converted to markdown and filed under `clips/` by the ship. Paywalled and logged-in pages archive this way, since the ship never fetches anything. |
| **Add to Calendar** | an event (timed, or all day when no time is given) or a task due that day, the title as the name and the selection and address as the note. The same `add-event` poke the calendar page sends. |
| **Ask Armillary** | one question about the selection, or the whole page's text when nothing is selected, answered by the endpoint `GET /apps/armillary/api/inference` names: openrouter on a lease, the vendor ship's proxy otherwise. The key never leaves the worker. The answer can be saved to Lattice as a page. It needs an inference key on the ship: until Armillary there has a vendor and a key, the card says so and offers to open Armillary. |

**The omnibox.** Type `urb` and a space in the address bar. A `urb://~ship/path` address opens in Lattice's reader, anything else searches it, and the dropdown offers the ship's bookmarks and history as you type (`/apps/lattice/omni-suggest`).

Reads, clips, bookmarks and archives run from the menu on their own and report in a notification. Mail, chat, calendar and Ask need a recipient, a chat, a date or a question, so they open the popup on that card.

**Urbit links on web pages.** Turn on **Clickable Urbit links on web pages** in Options and the pages you read get links where they had text: an `urb://` address keeps its own address, for whatever handles `urb://` on this computer (Lattice, Talon on the desktop), with a **↗** beside it that opens the same address in Lattice's reader on your ship (`/apps/lattice?url=`); furum's `f/~host/board` and `f/~host/board/42` open on your ship (`/apps/furum/b/~host/board`), as they do in Talon. An `urb://` link a page already has gets the **↗** too. The script builds nodes and sets text, never HTML from the page; it leaves links, form controls, editable regions and code alone, skips your ship's own pages, and looks again at what a page adds or changes at most twice a second.

## Ceilings

- **No held connection, no live counts.** Nothing here polls the ship or holds its change beacon. Mail notifications belong to the desktop app and the Thunderbird add-on, which already do that job. The popup makes requests only when you open it and only for the card you use.
- **Ask needs a second permission.** The answers come from a third origin, so the first Ask on a ship asks for that origin under your click. Refuse it and the request still goes out; it works if that endpoint allows browsers in.
- **Manifest v3**, so the worker is asleep between clicks. Every action carries what it needs in the message.
- Recipients are typed, not picked. The web client's contacts are one click away under **Edit in Auspex**.
- **Chats are listed by name, not by when they last spoke.** The ship's list of DMs has no order and the scry that has one is the heaviest the ship serves, so "recent" means the last eight picked here. The list is kept for ten minutes per browser session; a group joined since shows after that, or can be typed. DMs are named by ship, not by contact nickname.
- **A message is plain text and links.** Addresses become links; a `~ship` stays text rather than a mention (a page's text should not notify anyone), and Markdown and fenced code go as written.
- **Urbit links need every site.** A script that reads page text has to run on every page, which is the browser's broadest permission. So it is not in the manifest, which would ask everyone for it at install; it is registered from Options, and asks for access to all sites under that click. Turning it off stops the script; the browser keeps the site access until it is removed in the extension's settings. Content scripts get no view of the extension's stored settings (the Orrery key among them), and the only thing one may ask the worker is the ship's address.

## Testing

`npm test` covers the pure parts: ship names, page names, the calendar bodies, what a selection becomes, and for chat the three poke bodies, the story, the post id, the chat list from the scries' answers, and the channel round trip (the poke, its answer off the event stream, the channel deleted after) against a stand-in for eyre. For links, what counts as an `urb://` address or a furum shorthand and where each opens, pinned to Talon's own patterns.

`npm run smoke` runs the extension against a dev ship in a headless Brave: it stages a copy, launches once so the scratch profile records it, writes the ship's host permission into that record (Brave withholds a command-line extension's manifest host permissions, and without the permission the fetches are cross-site and carry no cookie), launches again with the session cookie set, drives the worker's handlers over the devtools protocol, checks each result against the app's own API, and removes what it made. Every ship request is capped at a minute, so a dev ship busy with another gate fails the run on time rather than on substance. It needs `SHIP` and `COOKIE_FILE` in the environment; `scripts/smoke.js` says how to mint the cookie. The cookie file is a secret: keep it out of the repo.

## Family

Talon on the phone, Auspex in Thunderbird and on the desktop, Lattice on the desktop and as a filesystem, and this in the browser. All of them are the same rule: the ship stores it, the client is a window on it.
