import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** One headline number. Kept dumb so every tab's stat strip looks identical. */
export function StatCard({
  label, value, sub, valueClassName,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", valueClassName)}>
          {value}
        </p>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
