import Image from 'next/image';

// Temporary portal lockout switch. Set this to false, or remove the guarded renders, to restore access.
export const WEB_PORTAL_ACCESS_RESTRICTED = true;

const references = [
  'Microsoft Trademark and Brand Guidelines',
  'Microsoft Software Licensing Terms',
  'Google Brand Guidelines',
  'Applicable third-party software terms and licenses'
];

export function SystemAccessRestricted(): JSX.Element {
  return (
    <div
      aria-describedby="system-access-description"
      aria-labelledby="system-access-title"
      aria-modal="true"
      className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/75 px-4 py-6 text-slate-950 backdrop-blur-sm sm:px-6 sm:py-8"
      role="dialog"
    >
      <div className="flex min-h-full items-center justify-center">
        <section className="w-full max-w-5xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-black/35">
          <header className="border-b border-slate-200 bg-slate-950 px-5 py-4 text-white sm:px-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Image
                  alt="VPOS logo"
                  className="h-11 w-11 rounded-md border border-white/15 bg-white p-1"
                  height={44}
                  priority
                  src="/logo.png"
                  width={44}
                />
                <div>
                  <p className="text-xs font-semibold uppercase text-red-200">POS Web Portal</p>
                  <p className="text-lg font-bold">System Access Restricted</p>
                </div>
              </div>
              <span className="w-fit rounded-full border border-red-300/40 bg-red-500/15 px-3 py-1 text-xs font-semibold uppercase text-red-100">
                Not Activated
              </span>
            </div>
          </header>

          <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
            <div className="px-5 py-6 sm:px-7 sm:py-8">
              <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl" id="system-access-title">
                System Access Restricted
              </h1>
              <div
                className="mt-5 space-y-4 text-sm leading-6 text-slate-700 sm:text-base"
                id="system-access-description"
              >
                <p>
                  This POS Web Portal is currently unavailable because the required software license has not been
                  activated or verified.
                </p>
                <p>
                  This application operates as a licensed companion service to the POS Desktop System and may integrate
                  with or operate alongside third-party software, platforms, services, and technologies.
                </p>
                <p>
                  Before this system can be used, the organization must maintain all licenses, subscriptions,
                  permissions, and authorizations required for the software and third-party services deployed in its
                  environment.
                </p>
                <p>
                  Third-party products and trademarks, including Microsoft&reg;, Windows&reg;, Google&trade;, and other
                  referenced products, remain the property of their respective owners. Their inclusion or reference does
                  not imply sponsorship, endorsement, certification, or affiliation.
                </p>
              </div>

              <div className="mt-7 border-t border-slate-200 pt-5">
                <h2 className="text-sm font-bold uppercase text-slate-500">Reference Information</h2>
                <ul className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  {references.map((reference) => (
                    <li className="flex gap-2" key={reference}>
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                      <span>{reference}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <aside className="border-t border-slate-200 bg-slate-50 px-5 py-6 sm:px-7 lg:border-l lg:border-t-0">
              <h2 className="text-sm font-bold uppercase text-slate-500">Access Status</h2>
              <dl className="mt-4 space-y-4">
                <div>
                  <dt className="text-xs font-semibold uppercase text-slate-500">License Status</dt>
                  <dd className="mt-1 text-lg font-bold text-red-700">Not Activated</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-slate-500">Web Portal</dt>
                  <dd className="mt-1 text-lg font-bold text-slate-950">Access Restricted</dd>
                </div>
              </dl>

              <p className="mt-6 text-sm leading-6 text-slate-700">
                Please contact your system administrator or authorized software provider to activate or verify your
                organization&apos;s license.
              </p>

              <div className="mt-6 flex flex-col gap-3">
                <button
                  className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-500"
                  disabled
                  type="button"
                >
                  View Licensing Information
                </button>
                <button
                  className="rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white opacity-60"
                  disabled
                  type="button"
                >
                  Contact Administrator
                </button>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
