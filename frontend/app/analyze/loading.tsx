import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyzeLoading() {
  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center gap-3">
          <Skeleton className="w-9 h-9 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="max-w-xl mx-auto space-y-4">
          <Card className="shimmer-mask">
            <CardContent className="p-0">
              <div className="p-14 flex flex-col items-center gap-4">
                <Skeleton className="w-16 h-16 rounded-2xl" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </CardContent>
          </Card>
          <div className="flex gap-3">
            <Skeleton className="flex-1 h-10 rounded-lg" />
            <Skeleton className="h-10 w-28 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
