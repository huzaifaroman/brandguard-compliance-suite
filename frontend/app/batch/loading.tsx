import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function BatchLoading() {
  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex items-center gap-3">
          <Skeleton className="w-9 h-9 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Card className="shimmer-mask">
          <CardContent className="p-0">
            <div className="p-10 flex flex-col items-center gap-4">
              <Skeleton className="w-16 h-16 rounded-2xl" />
              <Skeleton className="h-4 w-52" />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
