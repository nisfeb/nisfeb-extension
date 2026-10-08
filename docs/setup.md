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

An extension loaded this way still needs Developer mode.

## 3. Connect your ship

1. Click the nisfeb button in the toolbar (or press **Alt+Shift+U**), then **Options**.
2. Enter the ship's web address under **Ship URL**, for example `https://urbit.example.com`. Enter its `+code` under **Access code** (run `+code` in the ship's dojo).
3. Press **Connect** and allow the site when the browser asks. That permission is for your ship's address only.

The code is sent once to the ship's own login form and never stored. The browser keeps the session cookie the ship gives back. A restart of the ship ends that session: when a card says you are signed out, connect again.

## 4. Open your day

Click the nisfeb button, then **Today**. The page shows Talon's sky clock, then today's events, Orrery's open actions and its spend this month, unread mail and your Armillary balance. A card for an app your ship does not have says so, and the others still show. The page wears your Talon theme if you have a custom one.

The search box at the top searches Brave Search when you press Enter; **Research** starts Ask Brave's Deep Research with the same words.

The **Assistant** card is a box for asking about your day or saying what to do, answered by Armillary's model with your calendar and Orrery as its tools. Anything it would write (an event, a task, words for Orrery) is shown first and runs only when you press **Do it**. It needs an Armillary inference key on your ship, like **Ask**, and the model chosen for Ask in Options must be one that can call tools.

To arrange the cards, press and drag one onto the place it should take. A long press or a right-click on a card starts arranging, as in Talon: arrows step a card, **×** takes it off the page, the header offers back the cards taken off, and **Done** ends it.

Everything the page shows is set in **Options**, under **The day page**:

- **Use my Talon theme and font.** On by default. The line under it says what was last read from your ship: which Talon theme, its accent and its font. Off, the page uses Talon's own colours in the system's font.
- **Light or dark.** Talon keeps this per device, so set it as your Talon is. A custom Talon theme brings its own.
- **Location for the clock.** Type a town or postcode and press **Find**, then pick it from the list. Coordinates such as `51.5, -0.13` are taken as they are. Without a place the clock shows an even day and no weather. With one, it asks Open-Meteo for that place's weather every half hour, with the position rounded to about a kilometre. **Set a location** on the clock opens this field.
- **Browsing history into Orrery** (a section of its own). Turn it on and allow the browser's history when asked. Every hour Orrery gets the sites you visited, how many pages of each and their titles, never the pages' text. List any site never to send. **Send one now** sends the hour so far.
- **Background image.** Choose an image file. It stays in this browser only. **Remove the background** takes it away.

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

## 7. Armillary in Brave Leo (optional)

In Options, under **Use Armillary in Brave Leo**, press **Show Leo's values**. Then press **Open Leo's settings**, add a new model under **Bring your own model**, and paste each value with its **Copy** button. This needs an Armillary lease on your ship; with a proxy, Options says why Leo cannot use it.

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
| The clock shows no weather | No place is set, or Open-Meteo did not answer | Set a place in Options; a failed fetch is tried again after five minutes |
| The page does not look like your Talon | Talon's light or dark is per device, or the look has not been read | In Options, check the line under **Use my Talon theme and font**, and set **Light or dark** as your Talon is |
| Ctrl+T still opens Brave's dashboard | The new tab is not set to Homepage, or the home button has no custom address | Repeat step 5 |
