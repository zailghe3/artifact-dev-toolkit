import { ConversationPage } from "@/components/ConversationPage";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ConversationPage view="/conversations" params={await searchParams} />;
}
