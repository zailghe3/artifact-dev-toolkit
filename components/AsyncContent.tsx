import { ContentFailure } from "@/components/ContentFailure";

export async function AsyncContent<T>({ data, failure, children }: {
  data: Promise<T>;
  failure: string;
  children: (value: T) => React.ReactNode;
}) {
  let value: T;
  try {
    value = await data;
  } catch {
    return <ContentFailure title={failure} />;
  }
  return children(value);
}
