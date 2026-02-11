# quickenv

A bunx utility for managing environment variables across monorepos through a centralized source of truth with environment-specific tagging.

## Why quickenv?

Managing multiple `.env` files across a monorepo is tedious and error-prone. quickenv solves this by:

- **Single source of truth**: Define all environment variables in one `.env.quick` file
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
```

## How It Works

### File Architecture

```
repo-root/
├── quickenv.yaml       # Metadata & configuration (committable)
├── .env.quick          # Source of truth for all env vars (gitignored)
├── .quickenv.state     # Tracks active preset (gitignored)
├── .gitignore
└── apps/
    ├── web/
    │   └── .env.local  # Generated from .env.quick
    └── api/
        └── .env.local  # Generated from .env.quick
```

### The .env.quick Format

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
| `reset` | Revert local .env files to match .env.quick |
| `edit` | Open .env.quick in $EDITOR |
| `reload` | Re-sync without changing preset |

### Examples

```bash
# Switch to production preset
bunx quickenv switch production

# View variables for a specific suffix
bunx quickenv list --suffix .production

# Set a variable persistently in .env.quick
bunx quickenv set API_KEY secret123 --persist

# Interactive TUI for choosing projects and presets
bunx quickenv set DATABASE_URL

# Reset all .env files to match current preset
bunx quickenv reset
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

## Security

- **No secrets in config**: `quickenv.yaml` is designed to be committed; it contains metadata only
- **Gitignore respect**: Never reads or commits gitignored files (except `.quickenv.state`)
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
