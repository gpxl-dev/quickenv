import { Command } from "commander";
import pc from "picocolors";

export const helpCommand = new Command("man")
  .description("Display concise quickenv documentation")
  .action(() => {
    const b = pc.bold;
    const c = pc.cyan;

    console.log(`
${b("quickenv")}
  Manage monorepo .env files from one preset-based source file.

${b("Quick start")}
  quickenv init          create quickenv.yaml and .quickenv/.env.quick.yaml
  quickenv scan          import existing .env* files
  quickenv switch local  write generated env files
  quickenv status        inspect active preset, sources, projects
  quickenv list          inspect resolved variables

${b("Files")}
  ${c("quickenv.yaml")}                  committable project/preset metadata
  ${c(".quickenv/.env.quick.yaml")}      preferred secret source; gitignored
  ${c(".quickenv/.env.quick")}           legacy fallback source; gitignored
  ${c(".quickenv/.quickenv.state")}      active preset/envPath state; gitignored

${b(".env.quick.yaml format")}
  Top-level keys are selectable presets. Presets can inherit complete presets.

  base:
    "*":
      NODE_ENV: development
    shared:
      DATABASE_URL: postgres://localhost/app
    apps/api:
      $shared: [DATABASE_URL]
      PORT: 3000
  local:
    extends: base
    shared:
      DATABASE_URL: postgres://localhost/app_local

  "all" is an alias for "*". Scalar values become strings.
  Empty strings and UNSET remove a variable.
  The legacy .env.quick tagged format remains supported when YAML is absent.

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
  set <key> [value] --persist  update the highest-precedence source file
  edit                         open an environment source in $EDITOR
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

  Optional .worktreeinclude entries are copied. Select an existing preset or
  create one in an existing YAML source or a worktree-local source. Optional
  hooks run after activation with WORKTREE_PATH, BRANCH_NAME, and QUICKENV_PRESET.
`);
  });
