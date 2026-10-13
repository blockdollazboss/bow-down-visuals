import WittyLoader from "@/components/delight/witty-loader";
import { usePageTitle } from "@/hooks/use-page-title";

/* Demo page to preview the loading screen.
   Visit /loading-demo to see it without waiting for a real load. */
export default function LoadingDemo() {
  usePageTitle("Loading Demo", "Loading screen previews for Bow Down Visuals.");
  return <WittyLoader />;
}
