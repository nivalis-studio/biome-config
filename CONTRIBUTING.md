# Contributing

Thanks for helping keep the Nivalis Biome config sharp! This document outlines the expectations for contributors and the release workflow for maintainers.

## Prerequisites
- Node.js version defined in `.node-version`.
- `pnpm` (the repo is pinned to the version declared in `package.json` via the `packageManager` field).
- A recent version of Biome (installed as a dev dependency) and Git.

Install dependencies once after cloning:
```sh
pnpm install
```
The `prepare` script automatically installs Lefthook so local Git hooks can run Biome before commits.

## Development Workflow
1. Fork and clone the repository.
2. Create a feature branch (`git switch -c feat/my-change`).
3. Make your updates to `biome.json` or related metadata.
4. Run the checks (see below) until they pass.
5. Commit using the [Conventional Commits](https://www.conventionalcommits.org/) format (enforced by `commitlint`).
6. Push and open a pull request describing the motivation and impact.

## Required Checks
- `pnpm lint` – runs `biome check` to validate formatting, lint rules, and schema.
- `pnpm lint:fix` – runs `biome check --write` to apply safe fixes. Use it before committing to minimize review noise.

Biome is strict (see `AGENTS.md` for the precise guidance), so please make sure:
- Imports use the `node:` protocol for built-ins and avoid barrels/namespaces.
- Types are expressed with `type` aliases (no `interface`/`enum`).
- Arrays use `Array<T>` and there are no non-null assertions or constructor parameter properties.
- Prefer `const`, template strings, object spread, optional chaining, and avoid nested ternaries.
- Avoid `console` except for `warn`, `error`, or `debug` (tests/scripts have looser rules via overrides).

## Publishing (Maintainers)
1. Ensure `main` is up to date and all pull requests have been merged.
2. Run `pnpm lint` to double-check the final config.
3. Bump the version in `package.json` using semver (`npm version <patch|minor|major>` or edit manually).
4. Commit the version bump and create a corresponding git tag.
5. Publish to npm:
   ```sh
   pnpm publish --access public
   ```
   The registry and access level are preconfigured under `publishConfig`.
6. Push the commit and tag to GitHub so consumers can track the release.

## Need Help?
Open a discussion or issue if something in the configuration is unclear, or ping the maintainers on the relevant pull request. We're happy to collaborate.
