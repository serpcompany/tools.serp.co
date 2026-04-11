import { Card } from "@serp-tools/ui/components/card";
import { CheckCircle2 } from "lucide-react";

type TableConvertOptionsSectionProps = {
  title: string;
  subtitle?: string;
  items: string[];
};

export function TableConvertOptionsSection({
  title,
  subtitle,
  items,
}: TableConvertOptionsSectionProps) {
  if (!items || items.length === 0) return null;

  return (
    <section className="py-20 bg-gradient-to-b from-gray-50 to-white">
      <div className="mx-auto max-w-5xl px-6">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">{title}</h2>
          {subtitle && <p className="text-gray-600 max-w-2xl mx-auto">{subtitle}</p>}
        </div>

        <Card className="p-8 border-gray-200 bg-white">
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((item) => (
              <div key={item} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600" />
                <p className="text-sm text-gray-700 leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
