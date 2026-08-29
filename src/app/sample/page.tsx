import { PaperReader } from "@/components/paper-reader";
import { demoPaper } from "@/lib/demo";

export const metadata = { title: "Sample paper" };

export default function SamplePage() {
  return <PaperReader paper={demoPaper} />;
}
