import TableConvertLanding from "@/components/table-convert/TableConvertLanding";
import { buildToolMetadata, toolHeading } from "@/lib/metadata";

const fromFormat = "mediawiki" as const;
const toFormat = "markdown" as const;
const toolId = "mediawiki-to-markdown";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  return <TableConvertLanding from={fromFormat} to={toFormat} title={toolHeading(toolId)} />;
}
