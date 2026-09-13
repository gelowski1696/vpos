// Temporary portal lockout switch. Set this to false, or remove the guarded renders, to restore access.
export const WEB_PORTAL_ACCESS_RESTRICTED = true;

export function SystemAccessRestricted(): JSX.Element {
  return <main className="min-h-screen bg-white" />;
}
