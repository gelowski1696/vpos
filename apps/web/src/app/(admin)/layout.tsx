'use client';

import { AdminShell } from '../../components/admin-shell';
import { SystemAccessRestricted, WEB_PORTAL_ACCESS_RESTRICTED } from '../../components/system-access-restricted';

export default function AdminLayout({ children }: { children: React.ReactNode }): JSX.Element {
  // Comment out this guard, or set WEB_PORTAL_ACCESS_RESTRICTED to false, to restore admin routes.
  if (WEB_PORTAL_ACCESS_RESTRICTED) {
    return <SystemAccessRestricted />;
  }

  return <AdminShell>{children}</AdminShell>;
}
