'use client';

import { AdminShell } from '../../components/admin-shell';

export default function AdminLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <AdminShell>{children}</AdminShell>;
}
