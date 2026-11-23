// `UuidParam` parses a path id as a UUID and answers 404 on a malformed one, before it can reach a uuid column.
// A malformed id names no record, so it gets the same answer as an unknown one.
// apps/api/test/every-id-param-is-a-uuid.test.ts requires it on every path parameter not listed there.
import { HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';

export const UuidParam = (name: string): ParameterDecorator =>
  Param(name, new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }));
