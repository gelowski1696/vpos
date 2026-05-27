'use client';

type TablePaginationControlsProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  startRow: number;
  endRow: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
};

export function TablePaginationControls({
  page,
  pageSize,
  totalItems,
  totalPages,
  startRow,
  endRow,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  className
}: TablePaginationControlsProps): JSX.Element {
  if (totalItems <= 0) {
    return <></>;
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-800 ${className ?? ''}`}
    >
      <p className="text-slate-600 dark:text-slate-300">
        Showing <strong>{startRow}</strong>-<strong>{endRow}</strong> of{' '}
        <strong>{totalItems}</strong>
      </p>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <span>Rows</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            onChange={(event) => onPageSizeChange(Number.parseInt(event.target.value, 10))}
            value={String(pageSize)}
          >
            {pageSizeOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <button
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          Prev
        </button>
        <span className="text-slate-600 dark:text-slate-300">
          Page <strong>{page}</strong> / <strong>{totalPages}</strong>
        </span>
        <button
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}
