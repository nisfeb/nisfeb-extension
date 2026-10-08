# Setting up the nisfeb extension

From a fresh checkout to your day as Brave's new tab, in about five minutes. You need a running Urbit ship with the nisfeb apps you want to use (auspex, orrery, lattice, calendar, armillary), its web address, and its `+code`.

## 1. Get the code

```sh
git clone git@github.com:nisfeb/nisfeb-extension.git ~/software/personal/nisfeb-extension
```

Any folder works. Keep it where it is afterwards: the browser runs the extension from this folder, and its id (and so the day page's address) comes from the folder's path.

## 2. Load it into Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode**, the switch at the top right. Brave runs an extension that is not from the Web Store only in Developer mode. Without it, the card says "Turn on developer mode to use this extension, which can't be reviewed by the Web Store" and the extension stays off. Developer mode lets the browser run extensions loaded from a folder on this computer. It opens nothing up to websites.
3. Press **Load unpacked** and pick the folder from step 1.
4. Make sure the nisfeb card's own switch is on.

Chrome is the same at `chrome://extensions`.

**Loading it on every start instead.** Brave also takes `--load-extension=<folder>` on its command line. On Manjaro and Arch, the `brave` launcher reads extra flags from `~/.config/brave-flags.conf`, one per line:

```
--load-extension=/home/you/software/personal/nisfeb-extension
```

An extension loaded this way still needs Developer mode. Brave also withholds the manifest's host permissions from it, so allow the ship's site when Options asks (step 3).

## 3. Connect your ship

1. Click the nisfeb button in the toolbar (or press **Alt+Shift+U**), then **Options**.
2. Enter the ship's web address under **Ship URL**, for example `https://urbit.example.com`. Enter its `+code` under **Access code** (run `+code` in the ship's dojo).
3. Press **Connect** and allow the site when the browser asks. That permission is for your ship's address only.

The code is sent once to the ship's own login form and never stored. The browser keeps the session cookie the ship gives back. A restart of the ship ends that session: when a card says you are signed out, connect again.

## 4. Open your day

Click the nisfeb button, then **Today**. The page shows today's events, unread chats with mentions first, orrery's open actions, unread mail and your Armillary balance, with a reply box under the chats. A card for an app your ship does not have says so, and the others still show.

## 5. Make it your new tab (Brave)

1. In the extension's **Options**, press **Copy the address** under the day page. The address looks like `chrome-extension://<the extension's id>/today.html`. Brave makes the id from the folder's path, so it stays the same across restarts. If you move the folder, copy the new address and paste it again.
2. Open `brave://settings/appearance`. Turn on **Show home button**, choose the custom address, and paste the day page's address.
3. Open `brave://settings/getStarted`. Set **New tab page shows** to **Homepage**.
4. Press Ctrl+T (Cmd+T on a Mac). The new tab is your day.

To get Brave's own new tab back, set **New tab page shows** to **Dashboard**.

The extension does not take over the new tab by itself. An extension that overrides it replaces it for everyone who installs it, puts Chromium's plain page behind it, and leaves no way back but removing the extension. Chrome has no "new tab shows your homepage" setting, so in Chrome the day page opens from the popup's **Today** button.

## 6. Optional

- **Clickable Urbit links on web pages.** In Options, turn this on and allow access to all sites when asked. `urb://` addresses and furum's `f/~host/board` shorthand on the pages you read become links that open on your ship. Turning it off stops the script. The site access stays until you remove it in the extension's settings.
- **An Orrery client key.** In Options, paste a client key minted on your orrery's page. Pages you send to Orrery then carry the extension's own name and the key's limits, instead of yours.

## Updating

```sh
cd ~/software/personal/nisfeb-extension
git pull
```

Then press the reload arrow (↻) on the nisfeb card at `brave://extensions`, so the background worker runs the new code too.

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| "Turn on developer mode to use this extension" | Brave runs folder-loaded extensions only in Developer mode | Turn on **Developer mode** at `brave://extensions` |
| Every card says you are signed out | The ship restarted, or the session expired | Options, then **Connect** again with a fresh `+code` |
| One card says its app is not installed | Your ship does not run that app (or an older version) | Install or update the app on the ship, or ignore the card |
| A card says the ship did not answer | The ship is down, busy or unreachable | Wait and reopen. The card keeps what it last showed |
| Nothing at all works, and the popup does not respond | The background worker failed to load | `brave://extensions`, the nisfeb card, **Errors**; then the reload arrow |
| Ctrl+T still opens Brave's dashboard | The new tab is not set to Homepage, or the home button has no custom address | Repeat step 5 |
