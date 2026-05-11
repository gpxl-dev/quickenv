import { Command } from "commander";
import pc from "picocolors";

export const helpCommand = new Command("man")
  .description("Display concise quickenv documentation")
  .action(() => {
    const b = pc.bold;
    const c = pc.cyan;

    console.log(`
${b("quickenv")}
  Manage monorepo .env files from one tagged source file.

${b("Quick start")}
  quickenv init          create quickenv.yaml and .quickenv/.env.quick
  quickenv scan          import existing .env* files
  quickenv switch local  write generated env files
  quickenv status        inspect active preset, sources, projects
  quickenv list          inspect resolved variables

${b("Files")}
  ${c("quickenv.yaml")}             committable project/preset metadata
  ${c(".quickenv/.env.quick")}      secret source file; gitignored
  ${c(".quickenv/.quickenv.state")} active preset/envPath state; gitignored

${b(".env.quick format")}
  Global values are untagged. Sections may target presets, projects, or both.

  NODE_ENV=development

  [local]
  API_URL=http://localhost:3000

  [apps/api:local]
  DATABASE_URL=postgres://localhost:5432/api

  Resolution, low to high:
  1. global
  2. [project]
  3. [preset]
  4. [*:preset] or [project:*]
  5. [project:preset]

  Empty values and UNSET remove a variable.

${b("quickenv.yaml")}
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

  Target precedence: preset target, project target, defaultTarget, .env.
  Protected presets require confirmation when switching.

${b("Commands")}
  init                         bootstrap in current directory; no upward traversal
  scan [-y]                    import .env* files; respects .gitignore
  status                       show active preset, source files, projects, presets
  list [project] | show        show resolved variables; prompts if project omitted
  list --suffix <preset>       preview a preset without switching
  list --no-verbose            print simple KEY=value output
  switch [preset]              sync projects and save active preset
  reload                       sync the active preset again
  set <key> [value]            temporary update to generated env files
  set <key> [value] --persist  append to highest-precedence source file
  edit                         open source .env.quick in $EDITOR
  reset                        revert generated files from current source/preset
  worktree [branch]            create a git worktree with quickenv setup
  man                          print this reference

${b("Root traversal")}
  Every command except init searches upward for the nearest quickenv.yaml.
  Use --no-traversal to require quickenv.yaml in the current directory.

${b("Multiple sources")}
  .quickenv/.quickenv.state may set envPath to one file or an ordered array.
  Later files override earlier files.

${b("Worktrees")}
  quickenv worktree feature/my-branch
  quickenv-worktree feature/my-branch --path ../repo-feature

  Optional .worktreeinclude entries are copied. Optional hooks run from
  .quickenv/hooks/post-worktree.ts or .quickenv/hooks/post-worktree.sh with
  WORKTREE_PATH and BRANCH_NAME.
`);
  });
