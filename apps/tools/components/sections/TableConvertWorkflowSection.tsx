import { Card } from "@serp-tools/ui/components/card";
import type { LucideIcon } from "lucide-react";

export type WorkflowItem = {
  title: string;
  description: string;
  bullets: string[];
  icon: LucideIcon;
};

type TableConvertWorkflowSectionProps = {
  title: string;
  subtitle?: string;
  items: WorkflowItem[];
};

export function TableConvertWorkflowSection({
  title,
  subtitle,
  items,
}: TableConvertWorkflowSectionProps) {
  if (!items || items.length === 0) return null;

  return (
    <section className="py-20 bg-white">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">{title}</h2>
          {subtitle && <p className="text-gray-600 max-w-2xl mx-auto">{subtitle}</p>}
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="p-6 border-gray-200 bg-white">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{item.description}</p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  {item.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
