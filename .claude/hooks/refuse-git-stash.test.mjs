import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Importing the hook does not read stdin. The child-process block runs it as a hook.
import { evaluate } from './refuse-git-stash.mjs';

// In this release the kit's `claude/` folder stands in for the repository's `.claude/`.
const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, 'refuse-git-stash.mjs');
const SETTINGS = resolve(HERE, '../settings.json');

// The JSON a PreToolUse hook receives on stdin, in the documented shape.
function hookInput(command, tool = 'Bash') {
  return JSON.stringify({
    session_id: 'test-session',
    transcript_path: 'C:/Users/dev/.claude/projects/print-ops-erp/test-session.jsonl',
    cwd: 'C:/Users/dev/print-ops-erp',
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: { command, description: 'test', timeout: 120000, run_in_background: false },
    tool_use_id: 'toolu_test',
  });
}

function verdict(command, tool = 'Bash') {
  return evaluate(hookInput(command, tool));
}

function title(command, tool) {
  return `${JSON.stringify(command)}${tool === 'PowerShell' ? ' (PowerShell tool)' : ''}`;
}

const WT = 'C:/Users/dev/print-ops-erp/.claude/worktrees/preview-lane';
const SHA = 'c4e81a07b2f9d36e5a10c7d2fb84e9036a5d12bf';

// Every form that changes or consumes the list, in the shapes agents write it.
const REFUSED = [
  ['git stash', 'Bash'],
  ['git stash push -m "parked"', 'Bash'],
  ['git stash save "parked"', 'Bash'],
  ['git stash pop', 'Bash'],
  ['git stash drop stash@{1}', 'Bash'],
  ['git stash clear', 'Bash'],
  ['git stash branch tmp stash@{0}', 'Bash'],
  [`git stash store -m parked ${SHA}`, 'Bash'],
  ['git stash create', 'Bash'],
  ['git stash apply', 'Bash'],
  ['git stash apply stash@{0}', 'Bash'],
  ['git stash apply 1', 'Bash'],
  // All digits: git reads it as stash@{1234567}, not as a sha.
  ['git stash apply 1234567', 'Bash'],
  // Six characters is not a sha.
  ['git stash apply c4e81a', 'Bash'],
  ['git stash -u', 'Bash'],
  ['git stash --keep-index', 'Bash'],
  // git's global options in front of the subcommand.
  [`git -C ${WT} stash pop`, 'Bash'],
  [
    'git -C "C:/Users/dev/My Projects/print-ops-erp/.claude/worktrees/preview-lane" stash pop',
    'Bash',
  ],
  ['git -c core.pager=cat stash pop', 'Bash'],
  ['git --git-dir=/srv/erp/.git stash', 'Bash'],
  ['git --git-dir /srv/erp/.git --work-tree /srv/erp stash pop', 'Bash'],
  ['git --no-pager stash drop', 'Bash'],
  // Variables and wrappers in front of git.
  ['GIT_DIR=x git stash drop', 'Bash'],
  ['env GIT_TRACE=1 git stash', 'Bash'],
  ['timeout 30 git stash pop', 'Bash'],
  ['nohup git stash &', 'Bash'],
  // Inside a longer line.
  ['cd C:/Users/dev/print-ops-erp && git stash', 'Bash'],
  ['pnpm lint; git stash', 'Bash'],
  ['git status || git stash clear', 'Bash'],
  ['echo y | git stash drop', 'Bash'],
  ['(cd /srv/erp && git stash pop)', 'Bash'],
  ['git stash store "$(git stash create)"', 'Bash'],
  ['echo `git stash pop`', 'Bash'],
  ['git status\ngit stash pop', 'Bash'],
  ['git add -A && \\\n  git stash pop', 'Bash'],
  ['if true; then git stash pop; fi', 'Bash'],
  ['git stash list && git stash drop', 'Bash'],
  // The program written as a path or with its extension.
  ['git.exe stash push -m x', 'Bash'],
  ['"C:/Program Files/Git/cmd/git.exe" stash pop', 'Bash'],
  ['/usr/bin/git stash pop', 'Bash'],
  // A line another shell runs.
  ['bash -c "git stash pop"', 'Bash'],
  ["sh -lc 'cd /srv/erp && git stash'", 'Bash'],
  ['eval "git stash pop"', 'Bash'],
  ['powershell.exe -NoProfile -Command "git stash pop"', 'Bash'],
  ['cmd /c "git stash pop"', 'Bash'],
  // The PowerShell tool: backslash paths, the call operator, blocks.
  [
    'git -C C:\\Users\\dev\\print-ops-erp\\.claude\\worktrees\\preview-lane stash pop',
    'PowerShell',
  ],
  ['& git stash pop', 'PowerShell'],
  ['& "C:\\Program Files\\Git\\cmd\\git.exe" stash drop', 'PowerShell'],
  ['Set-Location C:\\Users\\dev\\print-ops-erp; git stash', 'PowerShell'],
  ['1..3 | ForEach-Object { git stash drop }', 'PowerShell'],
  ["Invoke-Expression 'git stash pop'", 'PowerShell'],
];

// Lines that read the list, or only mention the word.
const ALLOWED = [
  ['git stash list', 'Bash'],
  ['git stash list --format=%gd', 'Bash'],
  ['git stash show -p stash@{0}', 'Bash'],
  [`git -C ${WT} stash list`, 'Bash'],
  ['git stash apply c4e81a0', 'Bash'],
  [`git stash apply ${SHA}`, 'Bash'],
  ['git stash apply --index C4E81A07B2F9', 'Bash'],
  ['git log --grep stash', 'Bash'],
  ['git log --grep=stash', 'Bash'],
  ['git commit -m "no stash here"', 'Bash'],
  ['grep stash file.txt', 'Bash'],
  ['grep -rn "git stash" docs/', 'Bash'],
  ['git show stash@{0}', 'Bash'],
  [`git -C ${WT} show c4e81a07:docs/stash-notes.md`, 'Bash'],
  ['git add docs/stash.md && cat ./stash/notes.txt', 'Bash'],
  ['git -C C:/Users/dev/stash-copy status', 'Bash'],
  ['git status # then git stash pop', 'Bash'],
  ["cat >> notes.md <<'EOF'\ngit stash pop\nEOF", 'Bash'],
  ['git commit -F - <<EOF\nfix: a thing\n\ngit stash pop\nEOF\ngit log -1', 'Bash'],
  ['node -e "console.log(\'git stash pop\')"', 'Bash'],
  ['glab issue note 1 -m "never run git stash pop"', 'Bash'],
  ['echo "git stash pop"', 'Bash'],
  ['git stash list', 'PowerShell'],
  ["Write-Output 'git stash pop'", 'PowerShell'],
  ["$msg = @'\ngit stash pop\n'@", 'PowerShell'],
];

describe('refuse-git-stash: refused', () => {
  for (const [command, tool] of REFUSED) {
    it(`refuses ${title(command, tool)}`, () => {
      const result = verdict(command, tool);
      expect(result.exitCode).toBe(2);
      expect(result.message).toContain('one stash list');
    });
  }
});

describe('refuse-git-stash: allowed', () => {
  for (const [command, tool] of ALLOWED) {
    it(`allows ${title(command, tool)}`, () => {
      expect(verdict(command, tool)).toEqual({ exitCode: 0 });
    });
  }
});

describe('refuse-git-stash: the refusal', () => {
  it('names the command it refused, says why in one sentence, and gives the patch route', () => {
    const { message } = verdict('git stash list && git -C x stash drop');
    expect(message).toContain('`git -C x stash drop`');
    expect(message).toContain(
      'git keeps one stash list for the whole repository, shared by every worktree',
    );
    expect(message).toContain('git -C <worktree> diff HEAD --binary --output=<file>.patch');
    expect(message).toContain('git apply --stat <file>.patch');
    expect(message).toContain('git -C <worktree> apply --3way <file>.patch');
    expect(message).toContain('git stash apply <full commit sha>');
  });
});

describe('refuse-git-stash: input it cannot read is allowed', () => {
  for (const [label, raw] of [
    ['not JSON', 'git stash pop'],
    ['empty', ''],
    ['no tool_input', '{}'],
    ['a command that is not a string', '{"tool_name":"Bash","tool_input":{"command":42}}'],
    ['a JSON array', '[1,2]'],
    [
      'a tool that is not a shell',
      '{"tool_name":"Write","tool_input":{"command":"git stash pop","file_path":"x"}}',
    ],
  ]) {
    it(`allows ${label}`, () => {
      expect(evaluate(raw)).toEqual({ exitCode: 0 });
    });
  }
});

describe('refuse-git-stash: as Claude Code runs it, a node process reading stdin', () => {
  const runHook = (stdin) =>
    spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8', timeout: 10_000 });

  it('exits 2 with the reason on stderr and nothing on stdout', () => {
    const run = runHook(hookInput(`git -C ${WT} stash pop`));
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('one stash list');
  });

  it('exits 0 silently on an allowed command', () => {
    const run = runHook(hookInput('git stash list'));
    expect([run.status, run.stdout, run.stderr]).toEqual([0, '', '']);
  });

  it('exits 0 silently on input that is not JSON', () => {
    const run = runHook('{"tool_name": "Bash", "tool_input": ');
    expect([run.status, run.stdout, run.stderr]).toEqual([0, '', '']);
  });

  it('exits 0 silently on empty input', () => {
    const run = runHook('');
    expect([run.status, run.stdout, run.stderr]).toEqual([0, '', '']);
  });
});

describe('refuse-git-stash: registration', () => {
  it('runs before every Bash and PowerShell call, in exec form, from the settings file', () => {
    const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash|PowerShell',
        hooks: [
          {
            type: 'command',
            command: 'node',
            args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/refuse-git-stash.mjs'],
            timeout: 10,
          },
        ],
      },
    ]);
    expect(existsSync(HOOK)).toBe(true);
  });
});
