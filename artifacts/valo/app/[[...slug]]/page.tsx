import ClientApp from '@/client-app';
import type { Metadata } from 'next';

export async function generateMetadata({params}:{params:Promise<{slug?:string[]}>}):Promise<Metadata>{
  const {slug=[]}=await params;
  const titles:Record<string,string>={about:"About Valo",contact:"Contact Valo","account-access":"Account access help",
    help:"Help",library:"Document library",resources:"Business resources",industries:"Industries",
    compliance:"Business requirements",checker:"Business requirements checker",pricing:"Pricing",privacy:"Privacy",terms:"Terms"};
  const privateRoute=["workspace","staff","sign-in","sign-up","development"].includes(slug[0]??"");
  const title=slug.length?`${titles[slug[0]??""]??(privateRoute?"Your workspace":"Business resources")} — Valo`:"Valo — Documents and business requirements";
  return{title,description:"Private business documents and source-backed guidance for Nigerian SMEs.",
    robots:privateRoute?{index:false,follow:false}:undefined};
}

export default function Page() {
  return <ClientApp />;
}
