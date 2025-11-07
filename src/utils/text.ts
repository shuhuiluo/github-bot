/**
 * Truncate text to specified length and add ellipsis if needed
 */
export function truncateText(
  text: string | null | undefined,
  maxLength: number
): string {
  if (!text || text.trim() === "") return "";

  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;

  return trimmed.substring(0, maxLength) + "...";
}
