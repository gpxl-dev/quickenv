# quickenv

Manage monorepo `.env` files from one preset-based source file.

## Requirements

- Bun
- Git, if using worktree helpers

> This repo is currently private. From a checkout, use `bun run index.ts ...`. Published usage is `bunx quickenv ...` or `bun install -g quickenv`.

## Install / run

```bash
bun install
bun run index.ts --help
# after publish:
bunx quickenv --help
```

Entrypoints:

- `quickenv` / `bun run index.ts` — main CLI
- `quickenv-worktree` / `bun run scripts/create-worktree.ts` — worktree helper
- `quickenv worktree` — same helper through the main CLI

## Quick start

```bash
# 1. Create quickenv.yaml, .quickenv/.env.quick.yaml, and .gitignore entries
bun run index.ts init

# 2. Import existing .env* files, if any
bun run index.ts scan

# 3. Pick a preset and write generated env files to configured projects
bun run index.ts switch local

# 4. Inspect what is active and what values resolve
bun run index.ts status
bun run index.ts list
```

`init` detects projects from package workspaces and `**/.env.example`. It creates:

```text
quickenv.yaml             # committable metadata
.quickenv/.env.quick.yaml # secret source file; gitignored
```

`.quickenv/.quickenv.state` is created later by `switch` or worktree setup.

## Preset source: `.env.quick.yaml`

The preferred source format is `.quickenv/.env.quick.yaml`. Its top-level keys are presets. A preset groups common variables, reusable shared values, and values for specific projects.

```yaml
base:
  "*":
    NODE_ENV: development
    SOME_COMMON_VAR: foo

  shared:
    DATABASE_URL: "postgres://localhost:5432/app"
    HOSTNAME: localhost

  apps/api:
    $shared:
      - DATABASE_URL
      - HOSTNAME
    API_PORT: "3000"

  packages/logger:
    LOG_LEVEL: debug

local:
  extends: base
  shared:
    DATABASE_URL: "postgres://localhost:5432/app_local"

production:
  extends: local
  apps/api:
    HOSTNAME: api.example.com
```

The example uses these concepts:

- `"*"` contains common variables for all configured projects in that preset. `all` is an alias for `"*"`.
- `shared` defines reusable values. It does not apply those values to every project by itself.
- `$shared` under a project lists the shared values that the project pulls in.
- A project path such as `apps/api` or `packages/logger` contains values for that project. Direct project values can override inherited or shared values, as `HOSTNAME` does in `production`.
- `extends` inherits another preset before applying the child preset. Here, `local` inherits `base`, and `production` inherits the resulting `local` preset.

All YAML scalar values, including numbers, booleans, and `null`, become environment-variable strings. Empty strings and the exact string `UNSET` remove a variable.

### Source precedence and legacy compatibility

`.env.quick.yaml` takes precedence over `.env.quick`. When both `.quickenv/.env.quick.yaml` and `.quickenv/.env.quick` are available at the default source location, quickenv uses the YAML file. The legacy file remains a fallback for existing setups.

See [Legacy `.env.quick` format](LEGACY_FORMAT.md) for the prior tagged format, its resolution order, and unset behavior.

## `quickenv.yaml`

`quickenv.yaml` is separate from the secret source. It defines project targets, preset metadata, and output masking.

```yaml
projects:
  - path: apps/web
    target: .env.local
  - apps/api

defaultTarget: .env

presets:
  production:
    target: .env.production
    protected: true

variables:
  API_KEY:
    sensitive: true
  TOKEN:
    sensitive: true
    revealPattern: "^(.{4}).*(.{4})$"
    maskGroups: [1, 2]
```

Target precedence, highest to lowest: `presets.<preset>.target`, `projects[].target`, `defaultTarget`, `.env`.

`protected: true` marks risky presets. `switch` asks for confirmation and `status` shows the protection state.

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Bootstrap config/source files in the current directory. Does not traverse upward. |
| `scan [-y]` | Import discovered `.env*` files into config and the source file; respects `.gitignore`. |
| `status` | Show active preset, source files, projects, and available presets. |
| `list [project]` / `show` | Show resolved variables for active preset. Matches project path, basename, or partial path. |
| `list --suffix <preset>` | Preview another preset without switching. |
| `list --no-verbose` | Print simple `KEY=value` output. |
| `switch [preset]` | Write generated env files and save active preset. Prompts when omitted. |
| `reload` | Re-run `switch` for the active preset. |
| `set <key> [value]` | Temporarily update generated files for the active preset. Empty value removes. |
| `set <key> [value] --persist [--preset <preset>]` | Save the value to the highest-precedence source file. |
| `edit` | Open a source file in `$EDITOR`; prompts when multiple sources exist. |
| `reset` | Revert generated env files to the current source/active preset. |
| `man` | Print detailed built-in reference. |
| `worktree <branch>` | Create a Git worktree with quickenv setup. |
| `--no-traversal` | Require the current directory to contain `quickenv.yaml`. |

For every command except `init`, quickenv searches upward for the nearest `quickenv.yaml` and runs from that root.

## Multiple source files

`.quickenv/.quickenv.state` can point `envPath` at one file or an ordered list:

```json
{
  "activePreset": "local",
  "envPath": ["../shared/.quickenv/.env.quick.yaml", ".quickenv/.env.quick.yaml"]
}
```

Later files override earlier files. Missing custom paths are ignored while any custom path exists. If none exists, quickenv falls back to the default source location, where `.env.quick.yaml` takes precedence over the legacy `.env.quick` file.

## Worktrees

```bash
# from the main worktree
bun run index.ts worktree feature/my-branch
# or
bun run scripts/create-worktree.ts feature/my-branch --path ../repo-feature
```

Optional `.worktreeinclude` files are copied into the new worktree, for example:

```text
.quickenv/.env.quick.yaml
.env.local
```

The helper creates `.quickenv/.quickenv.state` in the new worktree. If the source worktree state has `envPath`, it copies that setting so the new worktree can share the same source files.

Optional hooks run after creation:

```text
.quickenv/hooks/post-worktree.ts  # preferred, runs with Bun
.quickenv/hooks/post-worktree.sh
```

Hook env vars: `WORKTREE_PATH`, `BRANCH_NAME`. Hook failure warns but does not undo the worktree.

## Security

- Commit `quickenv.yaml`; do not commit `.quickenv/`.
- Secret-looking output is masked by `variables.<name>.sensitive`.
- `scan` respects `.gitignore` and skips `.git`/`node_modules`.

## Development

```bash
bun install
bun run typecheck
bun test
bun run check
```

Useful local smoke test:

```bash
bun run index.ts status
bun run index.ts list --suffix local --no-verbose
```

## License

MIT
