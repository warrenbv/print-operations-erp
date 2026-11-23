// The words on the error boundary, apps/web/src/app/error.tsx. The framework's digest is offered as a reference when there is one.
export interface PageErrorNotice {
  readonly heading: string;
  readonly detail: string;

  readonly reference?: string;
}

export function pageErrorNotice(digest: string | undefined): PageErrorNotice {
  return {
    heading: 'This page could not be loaded',
    detail:
      'Something this page needed did not come back. The rest of the app is unaffected, so you can carry on elsewhere, or try this page again.',
    ...(digest === undefined || digest === '' ? {} : { reference: digest }),
  };
}
