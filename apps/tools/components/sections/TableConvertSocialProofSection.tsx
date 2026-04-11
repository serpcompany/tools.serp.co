import { Card } from "@serp-tools/ui/components/card";
import type { LucideIcon } from "lucide-react";

export type SocialProofGroup = {
  title: string;
  description: string;
  icon: LucideIcon;
};

type TableConvertSocialProofSectionProps = {
  title: string;
  subtitle?: string;
  groups: SocialProofGroup[];
};

export function TableConvertSocialProofSection({
  title,
  subtitle,
  groups,
}: TableConvertSocialProofSectionProps) {
  if (!groups || groups.length === 0) return null;

  return (
    <section className="py-20 bg-white">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">{title}</h2>
          {subtitle && <p className="text-gray-600 max-w-2xl mx-auto">{subtitle}</p>}
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {groups.map((group) => {
            const Icon = group.icon;
            return (
              <Card key={group.title} className="p-6 border-gray-200 bg-gray-50/60">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white text-blue-600">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{group.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{group.description}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
