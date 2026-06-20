import { Card, CardContent, CardHeader } from "@serp-tools/ui/components/card";
import { Wrench } from "lucide-react";

export default function ToolPlaceholder({ title }: { title: string }) {
  return (
    <main className="container py-8">
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <h1 className="flex items-center gap-2 text-base font-semibold leading-none">
            <Wrench className="h-5 w-5" />
            {title}
          </h1>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            This tool is coming soon! Check back later.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
