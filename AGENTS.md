**For Agents**

- Write code that passes this Biome config on first run. Use `biome check --write` to auto-fix.

**Imports/Exports**

- Use `node:` for Node builtins (e.g., `node:fs`) and `node:assert/strict`.
- Avoid barrel files and namespace imports. Prefer named imports.
- Use type-only imports/exports for types. Don’t export an imported binding; re-export from source.

**TypeScript**

- Prefer `type` aliases over `interface`; avoid `enum` and `namespace`.
- Use `Array<T>` over `T[]`.
- Don’t use non-null assertions or constructor parameter properties.
- Don’t annotate obvious types; lift magic numbers to named constants when needed.

**Code Style**

- Prefer `const`; avoid `.forEach()` in favor of `for...of`/`while`.
- Avoid nested ternaries and negation-else; use template strings.
- Use object spread and assignment shorthand; prefer optional chaining.
- Keep `switch` default last; avoid fallthrough.

**Correctness**

- No floating promises; use `await` in async functions when needed.
- Don’t assign to globals; don’t re-declare; use `globalThis` over `global`/`self`.
- React: no nested component defs; don’t assign to props; provide stable `key` in lists; no children on void elements.
- Hooks: call at top level and specify dependencies.

**React/Next**

- Use function components. Don’t render `<head>` directly.
- Use framework image components instead of raw `<img>` in supported frameworks.
- Avoid async client components in Next.

**Security**

- Add `rel="noopener"` to `target="_blank"` links.
- Don’t use `dangerouslySetInnerHTML`.

**Suspicious**

- `console` is limited to `warn|error|debug` (warned). No bitwise ops, `with`, or `var`.
- No import cycles, no import assignment, and don’t reassign imported bindings.

**Data/Config Files**

- JSON: tabs; width 2; no trailing commas. Comments/trailing commas allowed only in select config files (`package.json`, `tsconfig*.json`, `.vscode/*.json`, `.github/**/*.json`).
- Filenames: ASCII kebab-case (warn). Route files are exempt.

**Overrides**

- Tests: console and `any` allowed; cognitive complexity off.
- Scripts/binaries: console allowed; `process.env` allowed.
- Stories: unused imports/vars allowed. Decls (`*.d.ts`): unused/undeclared allowed.
- Generated/minified/docs/env: linter/formatter disabled.
