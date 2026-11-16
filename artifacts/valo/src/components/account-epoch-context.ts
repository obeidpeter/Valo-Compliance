import { createContext, useContext } from "react";
export const AccountEpoch = createContext<{ active: boolean } | null>(null);
export function useAccountEpoch() {
  const epoch = useContext(AccountEpoch);
  return () => epoch?.active === true;
}
