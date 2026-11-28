import type { TicketInputCategory } from "@workspace/api-client-react";
import { Show, useAuth, useUser } from "@clerk/react";
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
  // Until the sign-in service answers, a visitor is shown the way to sign in or to write without an
  // account, as the services page's form shows it (decision 0011, point 6). So the form's place is
  // never empty while that service loads, or when it cannot be reached.
  const { isLoaded } = useAuth();
  return (
    <>
      {isLoaded ? (
        <Show when="signed-out">
          <TicketSignedOut />
        </Show>
      ) : (
        <TicketSignedOut />
      )}
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
