# quickenv

A bunx utility for managing environment variables across monorepos through a centralized source of truth with environment-specific tagging.

## Why quickenv?

Managing multiple `.env` files across a monorepo is tedious and error-prone. quickenv solves this by:

- **Single source of truth**: Define all environment variables in one `.quickenv/.env.quick` file
- **Tagged environments**: Use presets like `[local]`, `[production]` to organize variables
- **Monorepo-aware**: Different values per project in your monorepo
- **Git-safe**: Separates metadata (committable) from secrets (gitignored)

## Installation

```bash
# Run directly with bunx
bunx quickenv

# Or install globally
bun install -g quickenv
```

This provides two commands:
- `quickenv` - Main CLI for managing environments
- `quickenv-worktree` - Helper for creating git worktrees with quickenv support

## Quick Start

```bash
# Initialize quickenv in your repository
bunx quickenv init

# Scan existing .env files and populate .env.quick
bunx quickenv scan

# View current environment configuration
bunx quickenv list

# Switch to a different preset (e.g., production)
bunx quickenv switch production

# Edit the source file directly
bunx quickenv edit

# Create a new worktree with quickenv support
quickenv-worktree feature/my-branch
```

## How It Works

### File Architecture

```
repo-root/
├── quickenv.yaml          # Metadata & configuration (committable)
├── .quickenv/
│   ├── .env.quick         # Source of truth for all env vars (gitignored)
│   └── .quickenv.state    # Tracks active preset (gitignored)
├── .gitignore
└── apps/
    ├── web/
    │   └── .env.local     # Generated from .quickenv/.env.quick
    └── api/
        └── .env.local     # Generated from .quickenv/.env.quick
```

### The .quickenv/.env.quick Format

A tagged INI-like format supporting multiple presets and projects:

```ini
# Variables shared by multiple presets
[local, preview]
NODE_ENV=development
API_URL=https://dev.api.example.com

# Variables specific to local preset
[local]
DATABASE_URL=postgres://localhost:5432/main
DEBUG=true

# Override for specific project:preset combination
[api-server:local]
DATABASE_URL=postgres://localhost:5432/api_dev

# Production preset
[production]
NODE_ENV=production
DEBUG=  # Empty value removes this var in production
```

**Tag Precedence** (highest to lowest):
1. `[project:preset]` or `[*:preset]` - Specific project and preset
2. `[preset]` - Preset-specific values
3. `[project:*]` or `[project]` - Project defaults
4. Global (untagged) - Universal defaults

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize quickenv with guided setup |
| `scan` | Discover and import existing .env files |
| `list` (or `show`) | Display effective variables for active preset |
| `switch [preset]` | Sync all projects to a preset (interactive TUI if no preset) |
| `set [key] [value]` | Update variables across presets |
| `reset` | Revert local .env files to match .quickenv/.env.quick |
| `edit` | Open .quickenv/.env.quick in $EDITOR |
| `reload` | Re-sync without changing preset |
| `worktree [branch]` | Create new git worktree with quickenv support (supports hooks) |

### Examples

```bash
# Switch to production preset
bunx quickenv switch production

# View variables for a specific suffix
bunx quickenv list --suffix .production

# Set a variable persistently in .quickenv/.env.quick
bunx quickenv set API_KEY secret123 --persist

# Interactive TUI for choosing projects and presets
bunx quickenv set DATABASE_URL

# Reset all .env files to match current preset
bunx quickenv reset

# Create a new worktree with quickenv support
quickenv-worktree feature/my-branch

# Create worktree at custom path
quickenv-worktree feature/my-branch --path ../my-project-feature
```

## Configuration (quickenv.yaml)

```yaml
projects:
  - path: apps/web
    suffix: .local
  - path: apps/api
    suffix: .local

variables:
  DATABASE_URL:
    sensitive: true
  API_KEY:
    sensitive: true
    # Optional: custom masking with regex
    revealPattern: "^(?<prefix>.{4}).*(?<suffix>.{4})$"
    maskGroups: [prefix, suffix]

tui:
  presets:
    - name: local
      description: Local development
    - name: production
      description: Production environment
```

## Worktree Support

quickenv works seamlessly with git worktrees. When you create a new worktree, you can automatically copy shared configuration files and set up quickenv.

### Setting Up Worktrees

1. Create a `.worktreeinclude` file in your main worktree:
```
# Files to copy when creating new worktrees
.quickenv/.env.quick
```

2. Create a new worktree with quickenv support:
```bash
# Create worktree for new feature branch
quickenv-worktree feature/my-branch
```

This will:
- Create a new git worktree for the branch
- Copy files listed in `.worktreeinclude`
- Initialize `.quickenv/.quickenv.state` with `envPath` pointing to the main worktree's `.quickenv/.env.quick`

### Worktree Configuration

Each worktree has its own `.quickenv/.quickenv.state` (tracking active preset) with `envPath` pointing to the shared `.quickenv/.env.quick`:

```
main-worktree/
├── .quickenv/
│   ├── .quickenv.state  # activePreset: production
│   └── .env.quick       # Shared secrets

feature-worktree/
├── .quickenv/
│   ├── .quickenv.state  # activePreset: local, envPath: ../main-worktree/.quickenv/.env.quick
│   └── .env.quick       # activePreset: local (worktree-specific)
```

This allows each worktree to have its own active preset while sharing the same environment definitions.

### Post-Worktree Hooks

You can run custom scripts after a worktree is created by placing a hook file in `.quickenv/hooks/post-worktree.{ts,sh}`. The hook runs from the newly created worktree directory with the following environment variables:

- `WORKTREE_PATH` - Absolute path to the new worktree
- `BRANCH_NAME` - Name of the branch for the worktree

**Supported formats:**
- `.ts` - TypeScript (runs with Bun)
- `.sh` - Shell script

**Priority:** If both `.ts` and `.sh` exist, the `.ts` hook is preferred.

**Example:**

```bash
# Create the hooks directory
mkdir -p .quickenv/hooks

# Create a TypeScript hook
cat > .quickenv/hooks/post-worktree.ts << 'EOF'
// Run npm install in the new worktree
import { $ } from "bun";

const worktreePath = process.env.WORKTREE_PATH;
console.log(`Setting up worktree at ${worktreePath}`);

await $`cd ${worktreePath} && npm install`.quiet();
console.log("Dependencies installed!");
EOF

# Or create a shell hook
cat > .quickenv/hooks/post-worktree.sh << 'EOF'
#!/bin/sh
echo "Setting up worktree at $WORKTREE_PATH"
cd "$WORKTREE_PATH" && npm install
echo "Done!"
EOF
chmod +x .quickenv/hooks/post-worktree.sh
```

**Notes:**
- Hooks are per-developer (`.quickenv/` is gitignored)
- If a hook fails (non-zero exit), a warning is shown but worktree creation continues
- Hook output is piped to the terminal

## Security

- **No secrets in config**: `quickenv.yaml` is designed to be committed; it contains metadata only
- **Gitignore respect**: Never reads or commits gitignored files (except `.quickenv/.quickenv.state`)
- **Sensitive masking**: Automatically masks sensitive variables in CLI output
- **Default masking**: Shows first/last 4 chars for values > 16 chars, or first/last 2 for shorter

## Requirements

- [Bun](https://bun.sh/) runtime

## Development

```bash
# Install dependencies
bun install

# Run the CLI
bun run index.ts

# Run tests
bun test
```

## License

MIT
