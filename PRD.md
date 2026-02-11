Product Requirements Document: quickenv
quickenv is a bunx utility designed to manage environment variables across monorepos (Turborepo, Nx, etc.) through a centralized "source of truth" and environment-specific tagging.

---

1. Overview
Managing multiple .env files in different subdirectories is tedious. quickenv allows you to define all environment variables in a single tagged file (`.quickenv/.env.quick`) and synchronize them into the appropriate .env files (e.g., .env.local, .env.production) based on an active "preset".

---

2. File Architecture
2.1 quickenv.yaml (Metadata & Configuration)
Located in the repository root. Defines the structure of the monorepo and security rules.
- projects: A list of directories and their associated .env file styles.
- variables: Global rules for specific keys (sensitivity, masking patterns).
- tui: UI configuration for switching presets.
- contains no variables, designed to be possible to commit to git.

2.2 .quickenv/.env.quick (The Source of Truth)
Located in the `.quickenv/` directory. This file uses an INI-like format with tags to define which variables apply to which presets and projects.
- Tags: 
  - `[preset1, preset2]` for global preset values.
  - `[project:preset]` for project-specific overrides.
  - `[project:*]` or `[project]` for project-specific defaults across all presets.
  - `[*:preset]` for preset-specific defaults across all projects.
- Precedence:
  1. `[project:preset]` or `[*:preset]` (Highest)
  2. `[preset]`
  3. `[project:*]` or `[project]`
  4. `Global` (untagged variables at the top of the file) (Lowest)
  5. Last definition in the file (if specificity is equal).
- Unset Values: KEY= (empty value) explicitly removes the variable from the target .env file during synchronization.

2.3 .quickenv/.quickenv.state (Active State)
A gitignored JSON file in the `.quickenv/` directory that tracks the current active preset (e.g., {"activePreset": "local"}).
- **New:** Allows configuring a custom path to the `.quickenv/.env.quick` file (e.g., `{"envPath": "../shared/.quickenv/.env.quick"}`). This enables sharing a single environment file across multiple monorepo roots or related projects.

---

3. Command Specifications

3.1 init
Guided setup to bootstrap quickenv in a repository.
- Discovery: Scans for package.json workspaces or directories containing .env.example.
- Git Safety: Crucial Rule: Only reads .env files if they are not gitignored (prioritizing .env.example).
- Setup: Generates quickenv.yaml, creates `.quickenv/.env.quick` (pre-filled from examples), and ensures `.quickenv/` is added to .gitignore.
3.2 list (alias show)
Displays the effective environment variables for the current active preset.
- Masking: 
  - If a variable is marked sensitive: true:
    - If revealPattern (Regex with Named Capture Groups) and maskGroups are defined: Masks only the specified groups.
    - Otherwise: Shows first/last 4 characters if length > 16, or first/last 2 if shorter.
- Suffix Support: Accepts --suffix <name> to view values for a specific suffix style without switching.
3.3 switch [preset]
Synchronizes the monorepo to a specific preset.
- Process:
  1. Identifies all variables in `.quickenv/.env.quick` matching the preset (applying precedence rules).
  2. For each project, writes the resolved variables to the designated file (e.g., apps/web/.env.local).
  3. Updates `.quickenv/.quickenv.state`.
- TUI: If no preset is provided, displays an interactive list. Hovering over a preset shows a preview of key variables (respecting masking).
3.4 set [key] [value]
Updates a variable across projects/presets.
- Persistence: Use --persist to update the value in `.quickenv/.env.quick`.
- Logic: Can update specific tags or create new ones.
- TUI: Guided flow to choose variable, projects, and target presets.
3.5 reset
Reverts local project .env files to match exactly what is defined in the current `.quickenv/.env.quick` preset. Useful if manual edits were made to local .env files.
3.6 edit
Opens the `.quickenv/.env.quick` file in the default editor (respects $VISUAL and $EDITOR).
---

4. Security & Privacy
- No Secret Storage in Config: quickenv.yaml is committed to Git; it contains metadata, not secrets.
- Gitignore Respect: quickenv will never automatically read or commit files that are gitignored unless they are the tools' own internal state files.
- Sensitive Masking: All CLI outputs and TUI previews strictly mask values marked as sensitive.

---
5. Technical Implementation
- Runtime: Bun
- Language: TypeScript
- Dependencies: 
  - commander (CLI)
  - @clack/prompts (TUI)
  - yaml (Config parsing)
  - zod (Validation)
  - ignore (Gitignore handling)
- Parser: A custom line-based parser for `.quickenv/.env.quick` to eventually support comment preservation and precise updates.
---

6. Example .quickenv/.env.quick Structure
# Shared by local and preview presets
[local, preview]
NODE_ENV=development
API_URL=https://dev.api.example.com
# Specific to local preset
[local]
DATABASE_URL=postgres://localhost:5432/main
DEBUG=true
# Override for the api-server project when in local preset
[api-server:local]
DATABASE_URL=postgres://localhost:5432/api_dev
# Production values
[production]
NODE_ENV=production
# This will be removed from target .envs in production
DEBUG=
