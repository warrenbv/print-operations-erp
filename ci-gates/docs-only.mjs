// docs-only: decides whether a merge request changes documentation only.
//
// The heavy pipeline jobs (typecheck, test, build, browser tests) cannot be
// affected by a documentation change. In the original pipeline their setup ran
// this first and ended the job early, as a success, when every changed file was
// documentation. ci-gates/pipeline.reference.yml shows that wiring, with the
// script at its path in the original layout.
// Exit 0 means documentation only. Exit 1 means run everything, which is also
// the answer outside a merge request, where there is no diff base.
//
// The list below names documentation shapes, not code paths. A path the list
// does not know, such as a new directory or extension, therefore always runs
// the full pipeline. The worst mistake it can make is a slow docs pipeline.
// It imports nothing, because it runs before dependencies are installed.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Agent skills and settings under .claude/ are prose, but its hooks/ folder is
// code with its own tests, so it is excluded.
const DOCUMENTATION_PATTERNS = [
  /^docs\//,
  /\.md$/,
  /^\.claude\/(?!hooks\/)/,
  /^\.forge\/issue_templates\//,
  /^\.forge\/merge_request_templates\//,
  /^tools\/training\/content\//,
];

export function isDocumentationPath(path) {
  return DOCUMENTATION_PATTERNS.some((pattern) => pattern.test(path));
}

// An empty change set proves nothing, so it is not documentation-only.
export function isDocsOnly(changedPaths) {
  return changedPaths.length > 0 && changedPaths.every(isDocumentationPath);
}

function main() {
  const base = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
  if (!base) {
    console.log('docs-only: not a merge request pipeline; running everything.');
    process.exit(1);
  }

  const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  if (isDocsOnly(changed)) {
    console.log(
      `docs-only: all ${changed.length} changed file(s) are documentation; this job has nothing to check.`,
    );
    process.exit(0);
  }

  const code = changed.filter((path) => !isDocumentationPath(path));
  console.log(`docs-only: ${code.length} non-documentation file(s) changed; running everything.`);
  process.exit(1);
}

// Importing the module (as the tests do) does not run the check.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
