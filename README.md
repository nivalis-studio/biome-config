# @nivalis/biome-config

Shared [Biome](https://biomejs.dev/) formatter, linter, and assist configuration used across the Nivalis projects. It encodes the conventions from `AGENTS.md` so every repo can stay in sync with a single dependency.

## Features

- Enforces consistent formatting rules for TS/JS, CSS, JSON, HTML, Markdown, and frameworks including React/Next.
- Ships with strict accessibility, correctness, performance, and security lint rules tuned for modern stacks.
- Provides sensible project-wide ignore patterns for build artifacts, coverage directories, and generated files.
- Includes overrides for scripts, tests, stories, and declaration files so the right amount of linting is applied per context.

## Installation

```sh
pnpm add -D @nivalis/biome-config
# or
npm install -D @nivalis/biome-config
yarn add -D @nivalis/biome-config
```

## Usage

Create a `biome.json` (or `biome.jsonc`) in your project root and extend this package:

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.3.7/schema.json",
  "extends": ["@nivalis/biome-config/biome.json"],
}
```

From there you can override any section locally, for example to loosen a rule for tests:

```jsonc
{
  "overrides": [
    {
      "includes": ["**/*.test.ts"],
      "linter": {
        "rules": {
          "correctness": { "noUnusedVariables": "off" },
        },
      },
    },
  ],
}
```

Add a lint script that surfaces violations quickly:

```json
{
  "scripts": {
    "lint": "biome check",
    "lint:fix": "biome check --write"
  }
}
```

Running `pnpm lint` fails on style or lint errors, while `pnpm lint:fix` auto-formats in place. The config also enables Biome Assist actions (auto import sorting, key sorting, etc.) inside supported editors.

## Repository Scripts

- `pnpm lint` – run Biome in check mode.
- `pnpm lint:fix` – run Biome with `--write` to apply safe fixes.
- `pnpm prepare` – installs Lefthook so Git hooks can run Biome before you commit.

## Publishing

This package is published to npm as `@nivalis/biome-config` with public access. To cut a new release:

1. Update the version in `package.json` following semver.
2. Run `pnpm install` and `pnpm lint` to ensure the config is valid.
3. Commit the changes and tag the release.
4. `pnpm publish --access public` (the registry is already configured via `publishConfig`).

## License

See the repository's license file for details (or add one if missing before publishing).
