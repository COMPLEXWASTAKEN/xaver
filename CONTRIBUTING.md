# Contributing to Xaver

Thanks for wanting to help. **Pull requests are how changes get into Xaver.** If you want a feature or a fix, the fastest way to get it is to open a PR for it. Issues are welcome for bugs and ideas, but there's no promise anyone else will pick them up.

## Requesting features

Before building something, see what people want:

- The [📋 Feature board](https://github.com/COMPLEXWASTAKEN/xaver/issues?q=is%3Aissue+is%3Aopen+label%3Afeature-board) lists every open request ranked by 👍. Vote on the ones you want instead of opening duplicates.
- New ideas go through the [feature request form](https://github.com/COMPLEXWASTAKEN/xaver/issues/new?template=feature_request.yml), or **About → Request a feature** in the app.
- Labels show where a request stands: **needs-triage** → **planned** / **help wanted** / **not planned** → **in progress** → closed when it ships.
- **help wanted** and **good first issue** are the best places to start a pull request.
- Link your pull request to the request with `Closes #<number>` in the description. The request is labelled **in progress** automatically and closes when the PR is merged.

## Before you start

- Xaver is built largely with AI coding tools. AI-assisted pull requests are fine. Just make sure you've run the change yourself and you understand what it does.
- For anything big (a new view, a new dependency, a change to how files are stored), open an issue first so we can agree on the approach before you spend time on it.
- Small fixes, wording changes and polish can go straight to a PR.

## Making a change

1. Fork the repo and create a branch off `main`, for example `fix/retry-timeout` or `feature/tag-filter`.
2. Install and run it:

   ```bash
   npm install
   npm run dev
   ```

3. Make your change, then check it:

   ```bash
   npm run typecheck
   ```

4. Try it in the app. If you touched downloads or scanning, run a real scan on a small profile.
5. Open a pull request against `main`.

CI builds every pull request on Windows, packages the app and checks that the build works. A PR needs a green build before it's merged.

## House style

- **No code comments.** This is deliberate. If code needs a comment to be understood, rename things or split it up instead. PRs that add comments will be asked to remove them.
- Match the code around you: naming, file layout, and the existing patterns for IPC, settings and styles.
- New settings go in `electron/shared/types.ts` with a default, are validated in `electron/main/storage/config.ts`, and get a row in the right Settings category.
- UI text should be short and plain. Say what happens, skip jargon, and avoid em dashes.
- Keep the security model intact: the UI has no Node access, everything goes through the typed preload bridge, and file access stays inside the output and data folders.
- Don't commit cookies, sessions, downloads or anything from `%APPDATA%`. `.gitignore` covers the usual suspects, so double-check before you push.

## Pull request checklist

- [ ] `npm run typecheck` passes
- [ ] Tried in the app with `npm run dev`
- [ ] Screenshot or short clip for UI changes
- [ ] No code comments, no secrets, no personal paths

## Security problems

Please don't open a public issue or PR for a security hole. Report it privately as described in [SECURITY.md](SECURITY.md).

## Licensing of contributions

Xaver is proprietary, not open source; see [LICENSE](LICENSE). By opening a pull request you agree that your contribution can be included in Xaver and distributed under the project's license, and that you have the right to submit it.
