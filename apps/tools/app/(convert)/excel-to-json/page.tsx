import TableConvertLanding from '@/components/table-convert/TableConvertLanding';
import { buildToolMetadata } from '@/lib/metadata';

const toolId = 'excel-to-json';

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  return <TableConvertLanding toolId={toolId} />;
}
