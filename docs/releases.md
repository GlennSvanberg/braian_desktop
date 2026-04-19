# Releasing Braian Desktop

Desktop installers are published as **GitHub Releases** assets. CI builds native bundles when you push a **version tag**.

## Before you tag

1. Bump **`version`** in both places (keep them identical):
   - [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) (`version`)
   - [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml) (`[package].version` for the `app` crate)
2. Commit the version bump on `master` (or your default branch).

## Create the release

1. Create an **annotated or lightweight tag** whose name matches the version with a `v` prefix, for example version `0.2.0` → tag **`v0.2.0`**.
2. Push the tag to GitHub:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Watch **Actions** → **Release desktop**. Each matrix job builds for one platform/arch and uploads bundles to the same GitHub Release.

The workflow file is [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml). It needs **`permissions: contents: write`** so the default **`GITHUB_TOKEN`** can upload release assets.

## Tag naming

Use **SemVer** tags: `vMAJOR.MINOR.PATCH` (optionally `v1.0.0-beta.1`). The workflow matches `v*` numeric tags.

## Code signing (optional)

The workflow produces **unsigned** bundles by default. To ship signed Windows/macOS installers, add the usual Tauri signing secrets and env vars in GitHub Actions, then extend the workflow (see [Tauri signing](https://v2.tauri.app/distribute/)).

## After the release

- **Web download link:** set `VITE_DESKTOP_RELEASES_REPO=Owner/repo` on Vercel (and locally in `.env.local` if needed) so the marketing site and in-app checks point at the correct repository.
- **Smoke-test** an installer from the release page on each OS you support.
