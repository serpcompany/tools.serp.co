import TableConvertLanding from '@/components/table-convert/TableConvertLanding';
import { buildToolMetadata } from '@/lib/metadata';

const toolId = 'markdown-to-matlab';

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  return <TableConvertLanding toolId={toolId} />;
}
