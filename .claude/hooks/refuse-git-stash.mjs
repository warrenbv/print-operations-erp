#!/usr/bin/env node
// refuse-git-stash: a Claude Code PreToolUse hook on the Bash and PowerShell
// tools. It refuses every `git stash` command that changes or consumes the
// stash list.
//
// Why: git keeps one stash list per repository, shared by every worktree.
// Agents working in parallel worktrees therefore share it, and stash@{0} is
// whichever agent stashed last, so one agent's pop can take another's work.
//
// Reads `tool_name` and `tool_input.command` from the hook input on stdin.
// Exit 0 with no output allows the call, and is also the answer to any input
// it cannot read. Exit 2 refuses it, with the reason on stderr for the agent.
//
// Allowed: `git stash list`, `git stash show`, and `git stash apply <sha>`.
// The line is parsed into simple commands rather than searched, so a word
// that only mentions stash never matches.
//
// Not covered: a git alias for stash, including one set on the line
// (`git -c alias.s=stash s pop`), a command held in a variable
// (`g=git; $g stash pop`), a word built by command substitution
// (`git $(echo stash) pop`), a script file that runs git, and
// `Start-Process`. Node built-ins only. Importing it does not read stdin.

import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const READ_ONLY_SUBCOMMANDS = new Set(['list', 'show', '-h', '--help']);

const APPLY_OPTIONS = new Set(['--index', '-q', '--quiet']);

// git's global options that take the next word as their value.
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--attr-source',
]);

// Programs that run the rest of their line as a command. `positionals` counts
// the words between the options and the command, such as timeout's duration.
const WRAPPERS = new Map([
  ['env', { valueOptions: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'] }],
  ['command', { valueOptions: [] }],
  ['builtin', { valueOptions: [] }],
  ['exec', { valueOptions: ['-a'] }],
  ['nohup', { valueOptions: [] }],
  ['time', { valueOptions: [] }],
  ['nice', { valueOptions: ['-n', '--adjustment'] }],
  ['timeout', { valueOptions: ['-s', '--signal', '-k', '--kill-after'], positionals: 1 }],
  ['stdbuf', { valueOptions: ['-i', '-o', '-e'] }],
  ['sudo', { valueOptions: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T'] }],
  ['xargs', { valueOptions: ['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s'] }],
]);

const RESERVED_WORDS = new Set([
  '!',
  '{',
  '}',
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);

// Bare `git stash` means `git stash push`, so no subcommand is refused.
export function stashChangesList(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === undefined) return true;
  if (READ_ONLY_SUBCOMMANDS.has(subcommand)) return false;
  if (subcommand === 'apply') {
    const commits = rest.filter((word) => !APPLY_OPTIONS.has(word));
    return !(commits.length === 1 && isCommitSha(commits[0]));
  }
  return true;
}

// An all-digit word is not a sha: git reads `apply 1234567` as stash@{1234567}.
export function isCommitSha(word) {
  return /^[0-9a-f]{7,40}$/i.test(word) && !/^[0-9]+$/.test(word);
}

// A path or an `.exe` suffix still names git.
function programName(word) {
  const name = word.split(/[\\/]/).pop() ?? '';
  return name.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
}

function skipOptions(words, from, valueOptions) {
  let i = from;
  while (words[i] !== undefined && words[i].startsWith('-')) {
    if (words[i] === '--') return i + 1;
    i += valueOptions.includes(words[i]) ? 2 : 1;
  }
  return i;
}

// The line that `bash -c`, `eval`, `powershell -Command`, `Invoke-Expression`
// or `cmd /c` runs, read again as its own command line.
function nestedLine(program, args) {
  if (program === 'eval') return { line: args.join(' '), shell: 'bash' };
  if (program === 'iex' || program === 'invoke-expression') {
    return { line: args.join(' '), shell: 'powershell' };
  }
  if (POSIX_SHELLS.has(program)) {
    const flag = args.findIndex((word) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word));
    const line = flag === -1 ? undefined : args[flag + 1];
    return line === undefined ? null : { line, shell: 'bash' };
  }
  if (POWERSHELLS.has(program)) {
    // PowerShell accepts any prefix of -Command.
    const flag = args.findIndex((word) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(word));
    return flag === -1 ? null : { line: args.slice(flag + 1).join(' '), shell: 'powershell' };
  }
  if (program === 'cmd') {
    const flag = args.findIndex((word) => /^\/[ck]$/i.test(word));
    return flag === -1 ? null : { line: args.slice(flag + 1).join(' '), shell: 'powershell' };
  }
  return null;
}

function refusedIn(words) {
  let i = 0;
  // Step past assignments, reserved words and wrappers to the real program.
  for (;;) {
    const word = words[i];
    if (word === undefined) return null;
    if (RESERVED_WORDS.has(word) || ASSIGNMENT.test(word)) {
      i += 1;
      continue;
    }
    const name = programName(word);
    const wrapper = WRAPPERS.get(name);
    if (!wrapper) break;

    // `command -v git` looks git up and does not run it.
    if (name === 'command' && /^-[vV]$/.test(words[i + 1] ?? '')) return null;
    i = skipOptions(words, i + 1, wrapper.valueOptions) + (wrapper.positionals ?? 0);
  }

  const program = programName(words[i]);
  const args = words.slice(i + 1);
  const nested = nestedLine(program, args);
  if (nested) return findRefusedStash(nested.line, nested.shell);
  if (program !== 'git') return null;

  // The subcommand is the first word after git's global options.
  let j = 0;
  while (args[j] !== undefined && args[j].startsWith('-')) {
    j += GIT_OPTIONS_WITH_VALUE.has(args[j]) ? 2 : 1;
  }
  if (args[j] !== 'stash') return null;
  return stashChangesList(args.slice(j + 1)) ? words.slice(i) : null;
}

function skipHeredocBodies(text, from, heredocs) {
  let pos = from;
  for (const { delimiter, stripTabs } of heredocs) {
    while (pos < text.length) {
      const newline = text.indexOf('\n', pos);
      const lineEnd = newline === -1 ? text.length : newline;
      let line = text.slice(pos, lineEnd).replace(/\r$/, '');
      // `<<-` lets the closing delimiter be indented with tabs.
      if (stripTabs) line = line.replace(/^\t+/, '');
      pos = lineEnd + 1;
      if (line === delimiter) break;
    }
  }
  return Math.min(pos, text.length);
}

// Reads simple commands into `commands` until `closer` or the end of the text,
// and returns the index after where it stopped. Substitutions recurse.
function readCommands(text, start, closer, shell, commands) {
  const escape = shell === 'powershell' ? '`' : '\\';
  let words = [];

  // null means no word has started. An empty string is a real, empty word.
  let word = null;

  let redirectTarget = false;

  let heredocOpen = null;

  let heredocs = [];

  // Counts PowerShell `@{` and `${`, which are part of a word, not a block.
  let braceDepth = 0;

  const endWord = () => {
    if (word === null) return;
    if (heredocOpen) {
      heredocs.push({ delimiter: word, stripTabs: heredocOpen.stripTabs });
      heredocOpen = null;
    } else if (redirectTarget) {
      redirectTarget = false;
    } else {
      words.push(word);
    }
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  const substitution = (from, end) => readCommands(text, from, end, shell, commands);

  let i = start;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    // An escaped newline continues the line.
    if (ch === escape) {
      if (next === '\n') i += 2;
      else if (next === '\r' && text[i + 2] === '\n') i += 3;
      else {
        word = (word ?? '') + (next ?? '');
        i += 2;
      }
      continue;
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      word = (word ?? '') + text.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (ch === '"') {
      word = word ?? '';
      i += 1;
      while (i < text.length && text[i] !== '"') {
        const c = text[i];
        const after = text[i + 1];
        if (c === escape && after !== undefined) {
          // In bash double quotes a backslash escapes only $ ` " \ and newline.
          if (shell === 'powershell' || '$`"\\\n'.includes(after)) {
            word += after === '\n' ? '' : after;
            i += 2;
          } else {
            word += c;
            i += 1;
          }
        } else if (c === '$' && after === '(') {
          // A substitution inside quotes still runs, so its commands are read.
          i = substitution(i + 2, ')');
          word += '$()';
        } else if (c === '`' && shell === 'bash') {
          i = substitution(i + 1, '`');
          word += '``';
        } else {
          word += c;
          i += 1;
        }
      }
      i += 1;
      continue;
    }
    if (ch === '$' && next === '(') {
      i = substitution(i + 2, ')');
      word = (word ?? '') + '$()';
      continue;
    }

    // A backtick here is bash command substitution. PowerShell's escape is handled above.
    if (ch === '`') {
      if (closer === '`') {
        endCommand();
        return i + 1;
      }
      i = substitution(i + 1, '`');
      word = (word ?? '') + '``';
      continue;
    }

    // A `#` at the start of a word begins a comment to the end of the line.
    if (ch === '#' && word === null) {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
      continue;
    }
    // Heredoc bodies start after the newline that ends their opening line.
    if (ch === '\n') {
      endCommand();
      i = heredocs.length > 0 ? skipHeredocBodies(text, i + 1, heredocs) : i + 1;
      heredocs = [];
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endWord();
      i += 1;
      continue;
    }
    if (ch === '(') {
      endCommand();
      i = substitution(i + 1, ')');
      continue;
    }
    if (ch === ')') {
      endCommand();
      i += 1;
      if (closer === ')') return i;
      continue;
    }
    // A PowerShell `{ }` script block holds commands of its own.
    if (shell === 'powershell' && (ch === '{' || ch === '}')) {
      if (ch === '{' && word !== null && /[@$]$/.test(word)) {
        braceDepth += 1;
        word += ch;
      } else if (ch === '}' && braceDepth > 0) {
        braceDepth -= 1;
        word = (word ?? '') + ch;
      } else {
        endCommand();
      }
      i += 1;
      continue;
    }

    // `;`, `|` and `&` end a command. `&&`, `||` and `;;` are read as two in a row.
    if (ch === ';' || ch === '|' || (ch === '&' && next !== '>')) {
      endCommand();
      i += 1;
      continue;
    }

    // Redirections. The target word is dropped, and a `<<` delimiter is remembered.
    if (ch === '>' || ch === '<' || ch === '&') {
      // A file-descriptor number in front of `>` is part of the redirection.
      if (word !== null && /^\d+$/.test(word)) word = null;
      else endWord();
      if (text.startsWith('<<<', i)) {
        i += 3;
        redirectTarget = true;
      } else if (shell === 'bash' && text.startsWith('<<', i)) {
        const stripTabs = text[i + 2] === '-';
        i += stripTabs ? 3 : 2;
        heredocOpen = { stripTabs };
      } else {
        i += 1;
        while (i < text.length && '>&|'.includes(text[i])) i += 1;
        redirectTarget = true;
      }
      continue;
    }
    word = (word ?? '') + ch;
    i += 1;
  }
  endCommand();
  return text.length;
}

// `shell` is 'bash' or 'powershell'. They differ in the escape character and
// in what backticks and braces mean.
export function simpleCommands(line, shell = 'bash') {
  const commands = [];
  readCommands(line, 0, null, shell, commands);
  return commands;
}

export function findRefusedStash(line, shell = 'bash') {
  for (const words of simpleCommands(line, shell)) {
    const refused = refusedIn(words);
    if (refused) return refused;
  }
  return null;
}

// What the agent reads: the reason in one sentence, then the patch route to use instead.
export function refusalMessage(words) {
  const shown = words.join(' ');
  const command = shown.length > 200 ? `${shown.slice(0, 200)}...` : shown;
  return [
    `Refused by .claude/hooks/refuse-git-stash.mjs: \`${command}\` changes or consumes the stash list.`,
    "git keeps one stash list for the whole repository, shared by every worktree, so stash@{0} can be another lane's work.",
    'To carry uncommitted work, use a patch instead:',
    '  1. Stage every new file: git -C <worktree> add <path>',
    '  2. Write the patch: git -C <worktree> diff HEAD --binary --output=<file>.patch',
    '  3. Read its file list back: git apply --stat <file>.patch',
    '  4. Apply it: git -C <worktree> apply --3way <file>.patch',
    'Reading is allowed: git stash list, git stash show, and git stash apply <full commit sha>.',
    'Why the rule exists: docs/process/working-with-coding-agents.md.',
  ].join('\n');
}

// Any input it cannot read is allowed, so a broken hook never blocks every command.
export function evaluate(raw) {
  try {
    const input = JSON.parse(raw);
    const command = input?.tool_input?.command;
    const tool = input?.tool_name;
    if (typeof command !== 'string') return { exitCode: 0 };
    if (tool !== undefined && !SHELL_TOOLS.has(tool)) return { exitCode: 0 };
    const refused = findRefusedStash(command, tool === 'PowerShell' ? 'powershell' : 'bash');
    return refused ? { exitCode: 2, message: refusalMessage(refused) } : { exitCode: 0 };
  } catch {
    return { exitCode: 0 };
  }
}

async function main() {
  let raw = '';
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
  } catch {
    return;
  }
  const { exitCode, message } = evaluate(raw);
  if (message) process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
}

// Runs as the hook only when executed directly. File names are compared, not
// full paths, because a path's case and separators vary by platform.
const invokedAs = process.argv[1] ? basename(process.argv[1]).toLowerCase() : '';
if (invokedAs === basename(fileURLToPath(import.meta.url)).toLowerCase()) {
  await main();
}
