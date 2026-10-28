# Contributing to Velin

Thanks for wanting to help. Bug reports, ideas, docs fixes and code changes are all welcome.

## Reporting a bug or suggesting something

Open an [issue](https://github.com/Tahsin2155/velin/issues). For a bug, include your browser and version, whether you use the extension or the web version, what you did, and what happened. A screenshot or console error helps. For something private, use the contact form on the [website](https://newvelintab.netlify.app).

## Changing the code

You're welcome to fork this repository on GitHub to prepare a pull request.

1. Fork the repo and create a branch from `main`.
2. Open `app.html` in a browser. There's no build step and no dependencies.
3. Make your change, keeping to the existing style: plain HTML, CSS and JavaScript, no frameworks or build tools.
4. Test it (see below).
5. Open a pull request that explains what changed and why. Small, focused pull requests are easier to review and merge than big ones.

I review pull requests myself, so replies may take a few days. If it's a big change, open an issue first so we can agree on the direction.

### Things to keep in mind

- **Extension compatibility.** `app.html` also runs as the extension's new tab page, which forbids inline scripts and inline event handlers. Put code in `script.js` or `storage.js`.
- **Stored data.** Don't change how data is stored in a way that breaks existing users' data without a migration. Export/import files should keep working.
- **Cleanup.** A new widget with a timer or global listener must register a cleanup. See "If you're extending this" in the README.
- **Cross-tab behaviour.** Changes to sync or locks need testing with two tabs open.
- **No new network calls** without discussing it first. Velin's promise is that your data stays in your browser.

### Testing

There's no automated test suite yet, so test by hand:

- Add one of each widget, reload, and check everything is still there.
- Open Velin in two tabs. Add, move and delete a widget in one and check the other follows.
- Try view and edit modes, a theme change, and export then import.
- To test as the extension: run `python build_extension.py`, unzip `dist/velin-extension.zip`, and load that folder with **Load unpacked** at `chrome://extensions`.

Describe what you tested in the pull request.

## Terms for contributions

By submitting a pull request, you confirm that you wrote the change yourself (or have the right to submit it), and you grant the maintainer a perpetual, worldwide, royalty-free, irrevocable license to use, modify, distribute and sublicense your contribution as part of Velin, including under any license Velin uses now or in the future. You keep the copyright in your own work. Forking and modifying the code to prepare a contribution to this repository is permitted. Velin has no open-source license, and all other rights are reserved.

If you're not comfortable with these terms, please open an issue describing the change instead.
