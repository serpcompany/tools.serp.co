import { notFound } from 'next/navigation';

import { buildToolFactoryReadModel } from '../../../lib/tool-factory-read-model.ts';
import { ToolFactoryTable } from './tool-factory-table.tsx';

export const dynamic = 'force-dynamic';

export default function ToolFactoryPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const model = buildToolFactoryReadModel();
  return (
    <ToolFactoryTable model={{ rows: model.rows, counts: model.counts }} />
  );
}
