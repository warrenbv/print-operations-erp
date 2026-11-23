// Tests `createDocumentsStores`: on PostgreSQL the storage root is proven writable at boot, and memory mode keeps documents in memory.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDocumentService, createDocumentsStores } from '../src/documents/documents.factory';

const DEPLOYED = { DATABASE_URL: 'postgres://erp@db.example.test:5432/erp' };

const REFUSED_CODE = process.platform === 'win32' ? 'EPERM' : 'EACCES';

const RUNNING_AS_ROOT = process.getuid?.() === 0;
const ROOT_SKIP_REASON = 'skipped as root, which ignores directory permissions';

if (RUNNING_AS_ROOT) {
  process.stdout.write(
    `documents.factory.test: the unwritable-directory case is ${ROOT_SKIP_REASON}\n`,
  );
}

function refuseWrites(dir: string): () => void {
  if (process.platform === 'win32') {
    const domain = process.env.USERDOMAIN;
    const who = domain === undefined ? userInfo().username : `${domain}\\${userInfo().username}`;
    execFileSync('icacls', [dir, '/deny', `${who}:(OI)(CI)(W)`], { stdio: 'ignore' });
    return () => execFileSync('icacls', [dir, '/remove:d', who], { stdio: 'ignore' });
  }
  chmodSync(dir, 0o555);
  return () => chmodSync(dir, 0o755);
}

async function bootError(env: NodeJS.ProcessEnv): Promise<Error> {
  try {
    const stores = await createDocumentsStores(env);
    await stores.close();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the boot to fail, and it did not');
}

describe('createDocumentsStores — the storage root is proven writable at boot', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'erp-documents-root-'));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('boots on a writable root, creating it, and leaves no probe file behind', async () => {
    const root = join(scratch, 'documents');

    const stores = await createDocumentsStores({ ...DEPLOYED, DOCUMENT_STORAGE_ROOT: root });
    await stores.close();

    expect(existsSync(root)).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });

  it('refuses to boot when the root sits under a plain file, naming the path and ENOTDIR', async () => {
    const plain = join(scratch, 'plain-file');
    writeFileSync(plain, 'not a directory');
    const root = join(plain, 'documents');

    const err = await bootError({ ...DEPLOYED, DOCUMENT_STORAGE_ROOT: root });

    expect(err.message).toContain(`DOCUMENT_STORAGE_ROOT "${root}" is not writable`);
    expect(err.message).toContain('ENOTDIR');
  });

  it.skipIf(RUNNING_AS_ROOT)(
    `refuses to boot on a directory it cannot write, naming the path and ${REFUSED_CODE} (${ROOT_SKIP_REASON})`,
    async () => {
      const root = join(scratch, 'documents');
      mkdirSync(root);
      const restore = refuseWrites(root);
      try {
        const err = await bootError({ ...DEPLOYED, DOCUMENT_STORAGE_ROOT: root });

        expect(err.message).toContain(`DOCUMENT_STORAGE_ROOT "${root}" is not writable`);
        expect(err.message).toContain(REFUSED_CODE);
      } finally {
        restore();
      }

      expect(readdirSync(root)).toEqual([]);
    },
  );

  it('memory mode never probes DOCUMENT_STORAGE_ROOT', async () => {
    const plain = join(scratch, 'plain-file');
    writeFileSync(plain, 'not a directory');

    const stores = await createDocumentsStores({
      DATA_PERSISTENCE: 'memory',
      DOCUMENT_STORAGE_ROOT: join(plain, 'documents'),
    });
    await stores.close();

    expect(stores.store).toBeDefined();
  });
});

describe('createDocumentsStores — memory mode keeps documents in memory', () => {
  const TEMP_KEYS = ['TMPDIR', 'TMP', 'TEMP'] as const;
  let scratch: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'erp-memory-docs-'));
    saved = Object.fromEntries(TEMP_KEYS.map((key) => [key, process.env[key]]));
    for (const key of TEMP_KEYS) process.env[key] = scratch;
  });

  afterEach(() => {
    for (const key of TEMP_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  it('generates and reads back a PDF without writing anything to the temp folder', async () => {
    expect(tmpdir()).toBe(scratch);
    const stores = await createDocumentsStores({ DATA_PERSISTENCE: 'memory' });
    const service = await createDocumentService(stores);

    const generated = await service.renderAndStore(
      'quote',
      'Q-0001',
      { type: 'quote', id: '01988a00-0000-7000-8000-000000000001' },
      { title: 'Quote Q-0001 v1', blocks: [{ type: 'heading', title: 'Quote' }] },
    );
    const received = await service.storeReceived({
      kind: 'purchase_order',
      subject: { type: 'order', id: '01988a00-0000-7000-8000-000000000002' },
      filename: 'po.pdf',
      declaredContentType: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1.4 demo purchase order'),
      uploadedBy: 'dev-sales',
    });

    expect(new TextDecoder().decode((await service.read(generated)).slice(0, 5))).toBe('%PDF-');
    expect((await service.read(received)).byteLength).toBeGreaterThan(0);
    await stores.close();

    expect(readdirSync(scratch)).toEqual([]);
  });
});
