// Primary keys are UUIDv7 generated in the application, so a record has its id before it reaches
// the database and keys sort by creation time: docs/decisions/010-orm-spike.md.
import { v7 } from 'uuid';

export function newId(): string {
  return v7();
}
