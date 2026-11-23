// The paper facts a quote or order document prints for each line, read once per grade.
// A grade that no longer exists is left out, and its line prints without them.
import { linePaperOf, type Grade, type LinePaper } from '@erp/types';

export async function linePapers(
  gradeIds: Iterable<string>,
  findGrade: (id: string) => Promise<Grade | null>,
): Promise<Map<string, LinePaper>> {
  const papers = new Map<string, LinePaper>();
  for (const id of new Set(gradeIds)) {
    const grade = await findGrade(id);
    if (grade !== null) {
      papers.set(id, linePaperOf(grade));
    }
  }
  return papers;
}
