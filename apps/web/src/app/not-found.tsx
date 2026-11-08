import Link from 'next/link';

export default function NotFoundPage(): React.JSX.Element {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5f4f7] px-6 py-12 text-[#202024]" data-public-error>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(112,71,235,0.13),transparent_30%),radial-gradient(circle_at_18%_82%,rgba(89,54,207,0.08),transparent_30%)]" />
      <section className="relative w-full max-w-xl border-l-2 border-violet-600 pl-6 sm:pl-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Error 404</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">Page not found</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">
          The address may be incorrect, or this workspace has moved. Return to a known page and continue your work.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700" href="/">
            Back to home
          </Link>
          <Link className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" href="/login">
            Admin login
          </Link>
        </div>
      </section>
    </main>
  );
}
