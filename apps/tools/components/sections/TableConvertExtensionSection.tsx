import { Button } from "@serp-tools/ui/components/button";
import { Card } from "@serp-tools/ui/components/card";
import type { LucideIcon } from "lucide-react";

export type QuickAction = {
  title: string;
  description: string;
  icon: LucideIcon;
};

type TableConvertExtensionSectionProps = {
  title: string;
  subtitle?: string;
  actions: QuickAction[];
  cta?: {
    label: string;
    href: string;
  };
};

export function TableConvertExtensionSection({
  title,
  subtitle,
  actions,
  cta,
}: TableConvertExtensionSectionProps) {
  if (!actions || actions.length === 0) return null;

  return (
    <section className="py-20 bg-blue-50/60">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">{title}</h2>
            {subtitle && <p className="text-gray-600 leading-relaxed">{subtitle}</p>}
            {cta && (
              <Button asChild size="lg" className="mt-6">
                <a href={cta.href}>{cta.label}</a>
              </Button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Card key={action.title} className="p-4 border-gray-200 bg-white">
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">
                    {action.title}
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{action.description}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
