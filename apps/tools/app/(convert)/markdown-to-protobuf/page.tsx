import TableConvertLanding from "@/components/table-convert/TableConvertLanding";
import { buildToolMetadata, toolHeading } from "@/lib/metadata";

const fromFormat = "markdown" as const;
const toFormat = "protobuf" as const;
const toolId = "markdown-to-protobuf";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  return <TableConvertLanding from={fromFormat} to={toFormat} title={toolHeading(toolId)} />;
}
