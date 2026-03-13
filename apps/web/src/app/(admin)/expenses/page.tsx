'use client';

import { EntityManager } from '../../../components/entity-manager';

export default function ExpensesPage(): JSX.Element {
  function activeMark(value: unknown): string {
    if (value === true || value === 'true' || value === 1 || value === '1') {
      return 'Yes';
    }
    return 'No';
  }

  return (
    <EntityManager
      defaultValues={{ code: '', name: '', isActive: true }}
      endpoint="/master-data/expense-categories"
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ]}
      tableColumnOverrides={{
        isActive: {
          label: 'Active',
          render: (value) => activeMark(value)
        }
      }}
      title="Expense Categories"
    />
  );
}
