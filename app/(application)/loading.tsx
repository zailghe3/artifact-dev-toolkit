import { ContentLoading, Skeleton } from "@/components/ContentLoading";

export default function ApplicationLoading() {
  return (
    <>
      <Skeleton className="mb-3 h-8 w-48 max-w-full" />
      <Skeleton className="mb-6 h-4 w-72 max-w-full" />
      <ContentLoading label="Loading page" />
    </>
  );
}
