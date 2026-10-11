// The accent colour of a converter's drop zone and button: one of twelve,
// picked by a hash of the formats, so each page keeps its colour.
const COLORS = [
  "#ef4444", // red-500
  "#f59e0b", // amber-500
  "#22c55e", // green-500
  "#3b82f6", // blue-500
  "#a855f7", // purple-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#6366f1", // indigo-500
  "#f43f5e", // rose-500
  "#0ea5e9", // sky-500
  "#84cc16", // lime-500
];

export function toolColor(from: string, to: string): string {
  const hashCode = (from + to).split("").reduce((hash, char) => char.charCodeAt(0) + ((hash << 5) - hash), 0);
  return COLORS[Math.abs(hashCode) % COLORS.length]!;
}
