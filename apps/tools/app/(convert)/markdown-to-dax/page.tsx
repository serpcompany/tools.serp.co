import TableConvertLanding from "@/components/table-convert/TableConvertLanding";
import { buildToolMetadata, toolHeading } from "@/lib/metadata";

const fromFormat = "markdown" as const;
const toFormat = "dax" as const;
const toolId = "markdown-to-dax";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  return <TableConvertLanding from={fromFormat} to={toFormat} title={toolHeading(toolId)} />;
}
