import { useEffect, useMemo, useState } from 'react';

type UseTablePaginationOptions = {
  initialPageSize?: number;
  pageSizeOptions?: number[];
  resetKey?: string | number;
};

export type TablePaginationResult<T> = {
  page: number;
  pageSize: number;
  pageSizeOptions: number[];
  totalItems: number;
  totalPages: number;
  startRow: number;
  endRow: number;
  pageRows: T[];
  setPage: (nextPage: number) => void;
  setPageSize: (nextPageSize: number) => void;
};

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

export function useTablePagination<T>(
  rows: T[],
  options?: UseTablePaginationOptions
): TablePaginationResult<T> {
  const pageSizeOptions = useMemo(() => {
    const uniqueSorted = Array.from(
      new Set(
        (options?.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS)
          .map((value) => Math.floor(Number(value)))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
    ).sort((a, b) => a - b);
    if (uniqueSorted.length === 0) {
      return DEFAULT_PAGE_SIZE_OPTIONS;
    }
    return uniqueSorted;
  }, [options?.pageSizeOptions]);

  const initialPageSize = useMemo(() => {
    const requested = Math.floor(Number(options?.initialPageSize ?? DEFAULT_PAGE_SIZE));
    if (pageSizeOptions.includes(requested)) {
      return requested;
    }
    return pageSizeOptions[0] ?? DEFAULT_PAGE_SIZE;
  }, [options?.initialPageSize, pageSizeOptions]);

  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  useEffect(() => {
    setPageSizeState(initialPageSize);
  }, [initialPageSize]);

  useEffect(() => {
    setPageState(1);
  }, [options?.resetKey]);

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPageState(totalPages);
    }
  }, [page, totalPages]);

  const pageRows = useMemo(() => {
    const offset = (page - 1) * pageSize;
    return rows.slice(offset, offset + pageSize);
  }, [rows, page, pageSize]);

  const startRow = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = totalItems === 0 ? 0 : Math.min(page * pageSize, totalItems);

  return {
    page,
    pageSize,
    pageSizeOptions,
    totalItems,
    totalPages,
    startRow,
    endRow,
    pageRows,
    setPage: (nextPage: number) => {
      const safePage = Math.min(Math.max(1, Math.floor(Number(nextPage) || 1)), totalPages);
      setPageState(safePage);
    },
    setPageSize: (nextPageSize: number) => {
      const normalized = Math.floor(Number(nextPageSize));
      if (!pageSizeOptions.includes(normalized)) {
        return;
      }
      setPageSizeState(normalized);
      setPageState(1);
    }
  };
}
