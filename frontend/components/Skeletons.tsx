"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function AnalysisResultSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="shimmer-mask">
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="w-20 h-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="shimmer-mask">
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 p-3">
              <Skeleton className="h-5 w-16 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function BatchResultsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="shimmer-mask">
          <CardContent className="p-4 flex justify-center">
            <Skeleton className="w-[140px] h-[140px] rounded-full" />
          </CardContent>
        </Card>
        {[1, 2, 3].map((i) => (
          <Card key={i} className="shimmer-mask">
            <CardContent className="p-5 text-center space-y-2">
              <Skeleton className="h-5 w-5 rounded-full mx-auto" />
              <Skeleton className="h-8 w-12 mx-auto" />
              <Skeleton className="h-3 w-16 mx-auto" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="shimmer-mask">
        <CardContent className="p-0">
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4 py-2">
                <Skeleton className="h-4 w-6" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-2 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function RulesSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="shimmer-mask">
          <div className="flex items-center gap-3 p-4">
            <Skeleton className="w-8 h-8 rounded-lg" />
            <Skeleton className="h-4 w-40 flex-1" />
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-4 w-4" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="shimmer-mask">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Skeleton className="w-12 h-12 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-3 w-10" />
                  <div className="flex-1" />
                  <Skeleton className="h-5 w-20 rounded" />
                </div>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
