import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { Show } from '@clerk/react';

export function RequireAuth({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}
