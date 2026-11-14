import {createContext,useContext,useLayoutEffect,useState,type ReactNode} from "react";
import {flushSync} from "react-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";

const Epoch=createContext<{active:boolean}|null>(null);
/** Async UI callbacks must not update global UI after their account unmounts. */
export function useAccountEpoch(){
  const epoch=useContext(Epoch);
  return()=>epoch?.active===true;
}
function AccountState({children}:{children:ReactNode}){
  const[epoch]=useState(()=>({active:true}));
  const[client]=useState(()=>new QueryClient({defaultOptions:{queries:{
    refetchOnWindowFocus:false,retry:(count,error)=>{
      const status=(error as {status?:number})?.status;
      return !(status&&status>=400&&status<500)&&count<2;
    },
  }}}));
  useLayoutEffect(()=>{
    epoch.active=true;
    return()=>{epoch.active=false;void client.cancelQueries();client.clear();};
  },[client,epoch]);
  return <Epoch.Provider value={epoch}><QueryClientProvider client={client}>{children}</QueryClientProvider></Epoch.Provider>;
}
/** Remounts component state AND query/mutation caches before the next paint.
 * A cache-only effect is insufficient for copied profile/checker form state. */
export function AccountStateBoundary({identityKey,children}:{identityKey:string|null;children:ReactNode}){
  const[suspended,setSuspended]=useState(false),[restoration,setRestoration]=useState(0);
  useLayoutEffect(()=>{
    const hide=()=>flushSync(()=>setSuspended(true));
    const show=(event:PageTransitionEvent)=>{
      if(event.persisted){window.location.reload();return;}
      flushSync(()=>{setRestoration(n=>n+1);setSuspended(false);});
    };
    window.addEventListener("pagehide",hide);window.addEventListener("pageshow",show);
    return()=>{window.removeEventListener("pagehide",hide);window.removeEventListener("pageshow",show);};
  },[]);
  if(suspended||identityKey===null)return <p role="status" className="p-6 text-sm">Refreshing your account…</p>;
  return <AccountState key={`${identityKey}/${restoration}`}>{children}</AccountState>;
}
