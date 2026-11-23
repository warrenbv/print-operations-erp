// Tests for the documentation-only decision. They import the rules from the
// script itself. Paths are fictional examples of each shape.
import { describe, expect, it } from 'vitest';

import { isDocsOnly, isDocumentationPath } from './docs-only.mjs';

describe('docs-only: what counts as documentation', () => {
  it('treats the docs tree, every markdown file, the agent files, the templates and the tour sources as documentation', () => {
    for (const path of [
      'docs/engineering/setup.md',
      'docs/training/platform-tour.html',
      'README.md',
      'CLAUDE.md',
      'modules/quoting/README.md',
      'apps/web/README.md',
      '.claude/skills/example-skill/SKILL.md',
      '.claude/settings.json',
      '.forge/issue_templates/defect.md',
      '.forge/merge_request_templates/default.md',
      'tools/training/content/sales.mjs',
    ]) {
      expect(isDocumentationPath(path), path).toBe(true);
    }
  });

  it('treats everything else as code, including the pipeline itself and files it has never heard of', () => {
    for (const path of [
      'pipeline.yml',
      // Hooks are code with their own tests, unlike the rest of .claude/.
      '.claude/hooks/example-hook.mjs',
      'apps/web/src/app/page.tsx',
      'modules/quoting/src/services/quote-service.ts',
      'packages/config/vitest/index.mjs',
      'infra/db/migrations/orders/0001_example.sql',
      'scripts/ci/docs-only.mjs',
      'tools/training/build.mjs',
      'tools/example-bot/rules.mjs',
      'e2e/orders.spec.ts',
      'pnpm-lock.yaml',
      'brand-new-top-level-dir/thing.ts',
      'docs-but-not-really.ts',
    ]) {
      expect(isDocumentationPath(path), path).toBe(false);
    }
  });
});

describe('docs-only: the decision', () => {
  it('is docs-only when every changed file is documentation', () => {
    expect(
      isDocsOnly([
        'docs/README.md',
        'modules/orders/README.md',
        '.claude/skills/example-skill/SKILL.md',
      ]),
    ).toBe(true);
  });

  it('is not docs-only when one code file rides along, so a README re-stamped beside a fix still runs everything', () => {
    expect(isDocsOnly(['modules/orders/README.md', 'modules/orders/src/data/schema.ts'])).toBe(
      false,
    );
  });

  it('is not docs-only when only a hook changes, so the hook tests run', () => {
    expect(isDocsOnly(['.claude/hooks/example-hook.mjs'])).toBe(false);
  });

  it('is not docs-only for an empty change set, because nothing was proven about it', () => {
    expect(isDocsOnly([])).toBe(false);
  });
});
