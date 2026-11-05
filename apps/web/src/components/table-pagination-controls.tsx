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
}: TablePaginationControlsProps): React.JSX.Element {
  if (totalItems <= 0) {
    return <></>;
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-adminBorder bg-adminSurface px-4 py-3 text-xs ${className ?? ''}`}
    >
      <p aria-live="polite" className="text-adminTextMuted">
        Showing <strong>{startRow}</strong>-<strong>{endRow}</strong> of{' '}
        <strong>{totalItems}</strong>
      </p>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-adminTextMuted">
          <span>Rows</span>
          <select
            aria-label="Rows per page"
            className="h-8 rounded-md border border-adminBorder bg-adminSurface px-2 text-xs text-adminText"
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
          aria-label="Previous page"
          className="h-8 rounded-md border border-adminBorder px-2.5 text-xs font-semibold text-adminText hover:bg-adminMuted disabled:cursor-not-allowed disabled:opacity-50"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          Prev
        </button>
        <span className="text-adminTextMuted">
          Page <strong>{page}</strong> / <strong>{totalPages}</strong>
        </span>
        <button
          aria-label="Next page"
          className="h-8 rounded-md border border-adminBorder px-2.5 text-xs font-semibold text-adminText hover:bg-adminMuted disabled:cursor-not-allowed disabled:opacity-50"
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
