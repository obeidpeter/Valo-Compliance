import type { TicketInputCategory } from "@workspace/api-client-react";
import { Show, useUser } from "@clerk/react";
import { TicketFormInner, TicketSignedOut } from "./ticket-form-parts";
export { CATEGORY_LABELS } from "@/lib/ticket-categories";

export function TicketForm({
  defaultCategory = "support",
  categories,
  intro,
}: {
  defaultCategory?: TicketInputCategory;
  categories?: TicketInputCategory[] | undefined;
  intro?: string | undefined;
}) {
  return (
    <>
      <Show when="signed-out">
        <TicketSignedOut />
      </Show>
      <Show when="signed-in">
        <SignedInTicketForm defaultCategory={defaultCategory} categories={categories} intro={intro} />
      </Show>
    </>
  );
}

function SignedInTicketForm(props: {
  defaultCategory: TicketInputCategory;
  categories?: TicketInputCategory[] | undefined;
  intro?: string | undefined;
}) {
  const { user } = useUser();
  return <TicketFormInner {...props} email={user?.primaryEmailAddress?.emailAddress ?? ""} />;
}
