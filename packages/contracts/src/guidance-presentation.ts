/** Refresh wording in previously saved guidance without changing its clinical content. */
export function guidancePresentationText(value: string): string {
  return value.replace(
    "The workbook lists four-hour separation from calcium, iron, multivitamins, antacids, and protein or soy supplements, and at least 30–60 minutes from coffee.",
    "Allow four-hour separation from calcium, iron, multivitamins, antacids, and protein or soy supplements, and at least 30–60 minutes from coffee.",
  );
}
