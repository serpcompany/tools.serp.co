import { ArrowRight } from "lucide-react";
import { Button } from "@serp-tools/ui/components/button";
import { withSerplyTracking } from "@/lib/downloader-extension-cta";
import { cn } from "@serp-tools/ui/lib/utils";

type SerplyCtaButtonProps = {
  href: string;
  label: string;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
};

export default function SerplyCtaButton({
  href,
  label,
  className,
  size = "default",
}: SerplyCtaButtonProps) {
  return (
    <Button
      asChild
      size={size}
      className={cn(
        "group rounded-full bg-[#0f62fe] px-6 font-semibold text-white shadow-none ring-0 transition-colors duration-200 hover:bg-[#0b4ccc] focus-visible:ring-2 focus-visible:ring-[#0f62fe]/35",
        className,
      )}
    >
      <a href={withSerplyTracking(href)} target="_blank" rel="noreferrer">
        {label}
        <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </a>
    </Button>
  );
}
