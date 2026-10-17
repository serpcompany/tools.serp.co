import TableConvertDemo from "@/components/TableConvertDemo";
import { buildTableConvertDemoMetadata } from "@/lib/table-convert";

export const metadata = buildTableConvertDemoMetadata();

export default function Page() {
  return <TableConvertDemo />;
}
