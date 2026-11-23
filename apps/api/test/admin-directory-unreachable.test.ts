// Tests that the Admin user search answers 503 `directory-unreachable` when the directory is down, and passes other failures through.
import { LdapUnreachableError, type AdminRoleService } from '@erp/identity';
import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AdminController } from '../src/admin/admin.controller';

function serviceThatThrows(error: unknown): AdminRoleService {
  return {
    searchUsers: () => Promise.reject(error),
    setRolesForUser: () => Promise.reject(new Error('not exercised here')),
  } as unknown as AdminRoleService;
}

describe('AdminController.search when the directory is unreachable', () => {
  it('answers 503 with a reason, not a 500', async () => {
    const controller = new AdminController(
      serviceThatThrows(new LdapUnreachableError('connect ECONNREFUSED 192.0.2.1:636')),
    );

    await expect(controller.search('smith')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uses the same reason word the login route uses', async () => {
    const controller = new AdminController(
      serviceThatThrows(new LdapUnreachableError('no route to host')),
    );

    try {
      await controller.search('');
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        reason: 'directory-unreachable',
      });
    }
  });

  it('does not swallow any other failure', async () => {
    const boom = new TypeError('cannot read properties of undefined');
    const controller = new AdminController(serviceThatThrows(boom));

    await expect(controller.search('')).rejects.toBe(boom);
  });

  it('returns the rows untouched when the directory answers', async () => {
    const rows = [
      {
        externalId: 'guid-1',
        username: 'jsmith',
        displayName: 'T Example',
        roles: ['Sales'],
        disabled: false,
        alreadyProvisioned: true,
      },
    ];
    const controller = new AdminController({
      searchUsers: () => Promise.resolve(rows),
    } as unknown as AdminRoleService);

    await expect(controller.search('smith')).resolves.toEqual({ items: rows });
  });
});
