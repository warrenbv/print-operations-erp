// The words on apps/web/src/app/forbidden/page.tsx, where apps/web/src/lib/fetch-parsed.ts sends a read the API refused with 403.
export interface ForbiddenNotice {
  readonly heading: string;
  readonly detail: string;
}

export function forbiddenNotice(): ForbiddenNotice {
  return {
    heading: 'Not allowed',
    detail:
      'Your account does not have the role this page needs. Ask an Admin to grant it if you should have access. The rest of the app is unaffected.',
  };
}
