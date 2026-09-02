import { redirect } from "next/navigation";
import { loadAppData, conversations } from "@/lib/app-data";

/**
 * /messages has no content of its own -- it drops you into whichever asset is
 * shouting loudest (most unanswered big movers, then most recent).
 */
export default async function MessagesIndex() {
  const data = await loadAppData();
  const first = conversations(data)[0];
  redirect(`/messages/${encodeURIComponent(first.asset.ticker)}`);
}
