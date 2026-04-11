import { Card } from "@serp-tools/ui/components/card";

type StatItem = {
  value: string;
  label: string;
  description?: string;
};

type TableConvertStatsSectionProps = {
  title: string;
  stats: StatItem[];
};

export function TableConvertStatsSection({
  title,
  stats,
}: TableConvertStatsSectionProps) {
  if (!stats || stats.length === 0) return null;

  return (
    <section className="py-16 bg-gradient-to-b from-white to-gray-50">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {stats.map((stat) => (
            <Card key={stat.label} className="p-6 border-gray-200 bg-white text-center">
              <div className="text-3xl font-semibold text-gray-900 mb-2">
                {stat.value}
              </div>
              <div className="text-sm font-semibold text-gray-900">{stat.label}</div>
              {stat.description && (
                <p className="mt-2 text-xs text-gray-600">{stat.description}</p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
