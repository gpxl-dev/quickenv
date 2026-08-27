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
  quickenv extract       move the active source to shared storage

${b("Files")}
  ${c("quickenv.yaml")}                  committable project/preset metadata
  ${c(".quickenv/.env.quick.yaml")}      preferred secret source; gitignored
  ${c(".quickenv/.env.quick")}           legacy fallback source; gitignored
  ${c(".quickenv/.quickenv.state")}      active preset/envPath state; gitignored

${b(".env.quick.yaml format")}
  Top-level keys are selectable presets. Presets can inherit one or more complete presets.

  base:
    "*":
      NODE_ENV: development
    shared:
      DATABASE_URL: postgres://localhost/app
    apps/api:
      $shared: [DATABASE_URL]
      PORT: 3000
  secrets:
    "*":
      PRIVY_APP_ID: your-privy-app-id
  local:
    extends: base, secrets
    shared:
      DATABASE_URL: postgres://localhost/app_local

  Parents are applied left to right, then the child. A YAML list also works.
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
  delete <key> [--preset ...]  delete a source definition (inheritance may restore it)
  edit                         open an environment source in $EDITOR
  reset                        revert generated files from current source/preset
  extract                      move the active YAML source to shared storage
  worktree [branch] [--no-switch]
                               create a git worktree and open a shell in it
  man                          print this reference

${b("Root traversal")}
  Every command except init searches upward for the nearest quickenv.yaml.
  Use --no-traversal to require quickenv.yaml in the current directory.

${b("Multiple sources")}
  .quickenv/.quickenv.state may set envPath to one file or an ordered array.
  Later files override earlier files.

${b("Shared source extraction")}
  quickenv extract

  Choose a shared directory outside the current worktree. Quickenv verifies the
  copied YAML source, sets mode 0600, and stores its canonical absolute path in
  .quickenv/.quickenv.state. quickenv.yaml stays tracked and does not move.

  Existing destination files require confirmation. Quickenv restores a replaced
  file if state setup fails. It can then link selected Git worktrees from the same
  repository. Quickenv removes identical local copies after linking. A worktree
  with distinct source data requires its own confirmation, and Quickenv leaves
  that file in place. Future worktrees inherit the same absolute source path.

${b("Worktrees")}
  quickenv worktree feature/my-branch
  quickenv-worktree feature/my-branch --path ../repo-feature

  If the branch is not local but origin/<branch> exists, the local branch tracks it.
  Otherwise, quickenv creates a new branch from the current commit. After setup,
  quickenv opens a shell in the new worktree. Exit it to return. Pass --no-switch
  to create the worktree without opening a shell.

  Optional .worktreeinclude entries are copied. Select an existing preset or
  create one in an existing YAML source or a worktree-local source. Optional
  hooks run after activation with WORKTREE_PATH, BRANCH_NAME, and QUICKENV_PRESET.
`);
  });
