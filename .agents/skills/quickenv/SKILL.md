---
name: quickenv
description: Uses quickenv to manage environment variables for the current project or monorepo. Use when initializing or scanning project environment configuration, inspecting or switching presets, updating variables, regenerating .env files, or setting up environment variables in Git worktrees.
---

# quickenv

Use quickenv instead of editing generated `.env` files directly.

## Command selection

Use `quickenv` when it is installed. In the quickenv source checkout, use `bun run index.ts` instead. Run `quickenv --help` or `quickenv man` when command details are needed.

Quickenv searches parent directories for the nearest `quickenv.yaml`. Add the global `--no-traversal` option when the command must operate only in the current directory.

## Workflow

1. Check `quickenv.yaml` to understand projects, targets, protected presets, and masking rules.
2. Run `quickenv status` before changing anything.
3. Preview resolved values with `quickenv list [project]` or another preset with `quickenv list --suffix <preset>`.
4. Apply the smallest suitable change.
5. Run `quickenv status` and `quickenv list [project]` again to verify it.

## Common operations

```bash
quickenv init                         # Create config and secret source files
quickenv scan                         # Import existing .env* files; respects .gitignore
quickenv status                       # Show active preset, projects, and sources
quickenv list [project]               # Show resolved variables for the active preset
quickenv list --suffix <preset>       # Preview a preset without switching
quickenv switch <preset>              # Generate project env files and activate a preset
quickenv reload                       # Regenerate files from the active preset
quickenv set <key> <value>            # Temporarily update generated files
quickenv set <key> <value> --persist  # Save to the environment source
quickenv set <key> <value> --persist --preset <preset>
quickenv reset                        # Discard temporary updates and regenerate files
quickenv edit                         # Open a source file in an editor
quickenv worktree <branch>            # Create a worktree with quickenv setup
```

Omitting the value from `set`, using an empty value, or storing the exact string `UNSET` removes the variable. Confirm the user's intent before removing variables.

## Configuration rules

- Commit `quickenv.yaml`.
- Never commit `.quickenv/`; it contains secret sources and state.
- Treat generated `.env` files and command output as sensitive.
- Define presets in `.quickenv/.env.quick.yaml`. Prefer this YAML source over the legacy `.env.quick` format.
- In YAML, `"*"` applies common values, `shared` defines reusable values, `$shared` imports them into a project, and `extends` inherits another preset.
- Later source files listed in `.quickenv/.quickenv.state` override earlier files.
- Mark secrets in `quickenv.yaml` with `variables.<name>.sensitive: true` and optionally configure `revealPattern` and `maskGroups`.

## Safety

`switch`, `reload`, `reset`, and temporary `set` rewrite generated target files. Preview first and do not hand-edit those files. Protected presets require confirmation; do not bypass or automate that confirmation. Use `scan --yes` only when unattended import is explicitly intended.
