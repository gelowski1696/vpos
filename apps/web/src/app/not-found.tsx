export default function NotFoundPage(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-brandPrimary">Page Not Found</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          The page you are looking for does not exist or has been moved.
        </p>
      </div>
    </main>
  );
}
