// Loads the paper grade catalog from the quoting API.
import { gradeListResponseSchema, type Grade } from '@erp/types';

import { fetchParsed } from '../../lib/fetch-parsed';

export async function loadGrades(): Promise<Grade[]> {
  return [...(await fetchParsed('/quoting/grades', gradeListResponseSchema)).items];
}
