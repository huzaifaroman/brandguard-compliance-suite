import { RulesSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function RulesLoading() {
  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-center gap-3">
          <Skeleton className="w-9 h-9 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-10 w-full rounded-lg mb-6" />
        <RulesSkeleton />
      </div>
    </div>
  );
}
