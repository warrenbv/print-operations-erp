// The words for a record that does not exist, on apps/web/src/app/not-found.tsx and in the tab title from apps/web/src/lib/record-title.ts.
// They differ from the error boundary's words in apps/web/src/lib/page-error.ts, because a missing record is not a failed read.
export interface NotFoundNotice {
  readonly heading: string;
  readonly detail: string;
}

export function notFoundNotice(): NotFoundNotice {
  return {
    heading: 'Not found',
    detail:
      'That record does not exist, or it has been removed. Check the link you followed, or search for it from the list. The rest of the app is unaffected.',
  };
}
