import TableConvertLanding from "@/components/table-convert/TableConvertLanding";
import { buildToolMetadata, toolHeading } from "@/lib/metadata";

const fromFormat = "csv" as const;
const toFormat = "ascii" as const;
const toolId = "csv-to-ascii";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  return <TableConvertLanding from={fromFormat} to={toFormat} title={toolHeading(toolId)} />;
}
