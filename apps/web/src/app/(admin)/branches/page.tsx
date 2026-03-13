"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EntityManager,
  type SelectOption,
} from "../../../components/entity-manager";
import {
  apiRequest,
  getSessionCompanyId,
  getSessionRoles,
} from "../../../lib/api-client";

type TenantSummary = {
  company_id: string;
  company_code: string;
  company_name: string;
};

function branchTypeLabel(value: unknown): string {
  if (value === "WAREHOUSE") {
    return "Warehouse";
  }
  return "Store";
}

function yesNo(value: unknown): string {
  if (value === true || value === "true" || value === 1 || value === "1") {
    return "Yes";
  }
  return "No";
}

function generateShortCode(prefix: string): string {
  const normalizedPrefix = prefix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4) || "BR";
  const suffixLength = Math.max(1, 8 - normalizedPrefix.length);
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const suffix = seed.slice(-suffixLength).padStart(suffixLength, "0");
  return `${normalizedPrefix}${suffix}`.slice(0, 8);
}

export default function BranchesPage(): JSX.Element {
  const sessionRoles = useMemo(() => getSessionRoles(), []);
  const sessionCompanyId = useMemo(() => getSessionCompanyId(), []);
  const isPlatformOwner = sessionRoles.includes("platform_owner");
  const canEdit =
    sessionRoles.includes("owner") || sessionRoles.includes("platform_owner");

  const [tenantOptions, setTenantOptions] = useState<SelectOption[]>([]);
  const [selectedTenantCompanyId, setSelectedTenantCompanyId] = useState(
    sessionCompanyId ?? "",
  );
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [hardDeleteError, setHardDeleteError] = useState<string | null>(null);
  const [hardDeleteNotice, setHardDeleteNotice] = useState<string | null>(null);
  const [liveFormState, setLiveFormState] = useState<{
    mode: "create" | "edit";
    editingId: string | null;
    code: string;
  }>({
    mode: "create",
    editingId: null,
    code: "",
  });
  const [liveCodeState, setLiveCodeState] = useState<
    "idle" | "invalid" | "checking" | "exists" | "available"
  >("idle");
  const codeCheckTokenRef = useRef(0);
  const codeCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isPlatformOwner) {
      return;
    }

    let active = true;
    const loadTenants = async (): Promise<void> => {
      try {
        const rows = await apiRequest<TenantSummary[]>(
          "/platform/owner/tenants",
        );
        if (!active) {
          return;
        }

        const options = rows.map((row) => ({
          value: row.company_id,
          label: `${row.company_name} (${row.company_code})`,
        }));
        setTenantOptions(options);
        setTenantLoadError(null);
        if (!selectedTenantCompanyId) {
          const preferred =
            sessionCompanyId &&
            options.some((option) => option.value === sessionCompanyId)
              ? sessionCompanyId
              : (options[0]?.value ?? "");
          setSelectedTenantCompanyId(preferred);
        }
      } catch (loadError) {
        if (!active) {
          return;
        }
        setTenantLoadError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load tenant list",
        );
      }
    };

    void loadTenants();
    return () => {
      active = false;
    };
  }, [isPlatformOwner, selectedTenantCompanyId, sessionCompanyId]);

  const endpoint = useMemo(() => {
    if (isPlatformOwner && selectedTenantCompanyId) {
      return `/master-data/branches?companyId=${encodeURIComponent(selectedTenantCompanyId)}`;
    }
    return "/master-data/branches";
  }, [isPlatformOwner, selectedTenantCompanyId]);

  useEffect(() => {
    if (codeCheckTimerRef.current) {
      clearTimeout(codeCheckTimerRef.current);
      codeCheckTimerRef.current = null;
    }

    const normalizedCode = String(liveFormState.code ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!normalizedCode) {
      setLiveCodeState("idle");
      return;
    }
    if (normalizedCode.length < 1 || normalizedCode.length > 8) {
      setLiveCodeState("invalid");
      return;
    }
    if (isPlatformOwner && !selectedTenantCompanyId) {
      setLiveCodeState("idle");
      return;
    }

    const token = codeCheckTokenRef.current + 1;
    codeCheckTokenRef.current = token;
    setLiveCodeState("checking");
    codeCheckTimerRef.current = setTimeout(() => {
      const query = new URLSearchParams();
      query.set("code", normalizedCode);
      if (isPlatformOwner && selectedTenantCompanyId) {
        query.set("companyId", selectedTenantCompanyId);
      }
      if (liveFormState.mode === "edit" && liveFormState.editingId) {
        query.set("excludeId", liveFormState.editingId);
      }
      void apiRequest<{ exists: boolean }>(
        `/master-data/branches/code-exists?${query.toString()}`,
      )
        .then((result) => {
          if (codeCheckTokenRef.current !== token) {
            return;
          }
          setLiveCodeState(result.exists ? "exists" : "available");
        })
        .catch(() => {
          if (codeCheckTokenRef.current !== token) {
            return;
          }
          setLiveCodeState("idle");
        });
    }, 250);

    return () => {
      if (codeCheckTimerRef.current) {
        clearTimeout(codeCheckTimerRef.current);
        codeCheckTimerRef.current = null;
      }
    };
  }, [
    isPlatformOwner,
    liveFormState.code,
    liveFormState.editingId,
    liveFormState.mode,
    selectedTenantCompanyId,
  ]);

  async function handlePermanentDelete(row: Record<string, unknown>): Promise<void> {
    if (!isPlatformOwner) {
      return;
    }
    const id = String(row.id ?? "").trim();
    if (!id) {
      return;
    }
    const label = String(row.name ?? row.code ?? id);
    const confirmed = window.confirm(
      `Permanently delete branch "${label}"? This cannot be undone and will fail if linked transactions exist.`,
    );
    if (!confirmed) {
      return;
    }

    setHardDeleteError(null);
    setHardDeleteNotice(null);
    try {
      const query =
        isPlatformOwner && selectedTenantCompanyId
          ? `?companyId=${encodeURIComponent(selectedTenantCompanyId)}`
          : "";
      await apiRequest(`/master-data/branches/${encodeURIComponent(id)}/permanent${query}`, {
        method: "DELETE",
      });
      setHardDeleteNotice(`Branch "${label}" permanently deleted.`);
      setReloadSignal((current) => current + 1);
    } catch (error) {
      setHardDeleteError(
        error instanceof Error ? error.message : "Failed to permanently delete branch",
      );
    }
  }

  return (
    <div className="space-y-3">
      {isPlatformOwner ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <label className="flex flex-col gap-1 text-sm md:max-w-md">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Tenant Scope
            </span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) =>
                setSelectedTenantCompanyId(event.target.value)
              }
              value={selectedTenantCompanyId}
            >
              <option value="">Select tenant...</option>
              {tenantOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Branch list and save actions are scoped to the selected tenant.
            </span>
          </label>
          {tenantLoadError ? (
            <p className="mt-2 text-xs text-rose-700">{tenantLoadError}</p>
          ) : null}
        </div>
      ) : null}

      {hardDeleteNotice ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{hardDeleteNotice}</p>
      ) : null}
      {hardDeleteError ? <p className="text-sm text-rose-700">{hardDeleteError}</p> : null}

      <EntityManager
        allowDelete={canEdit}
        defaultValues={{ code: "", name: "", type: "STORE", isActive: true }}
        deleteConfirmText="Safe delete will mark this branch inactive and also mark all linked locations inactive."
        reactivateConfirmText="This will reactivate the branch. Linked locations remain unchanged unless reactivated separately."
        endpoint={endpoint}
        fields={[
          {
            key: "code",
            label: "Branch Code",
            helperText:
              "Optional short code (1-8, A-Z/0-9). Leave blank to auto-generate.",
          },
          {
            key: "name",
            label: "Branch Name",
            required: true,
            helperText: "Display name used in POS and reports.",
          },
          {
            key: "type",
            label: "Branch Type",
            type: "select",
            required: true,
            options: [
              { value: "STORE", label: "Store (Sales branch)" },
              { value: "WAREHOUSE", label: "Warehouse (Stock hub)" },
            ],
          },
        ]}
        tableColumnOverrides={{
          type: {
            label: "Branch Type",
            render: (value) => branchTypeLabel(value),
          },
          isActive: {
            label: "Active",
            render: (value) => yesNo(value),
          },
        }}
        readOnly={!canEdit}
        readOnlyMessage=""
        reloadSignal={reloadSignal}
        rowActions={
          isPlatformOwner
            ? [
                {
                  key: "hard-delete",
                  label: "Delete Permanently",
                  buttonClassName:
                    "rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40",
                  onClick: (row) => {
                    void handlePermanentDelete(row);
                  },
                },
              ]
            : []
        }
        title="Branches"
        onFormStateChange={(form, context) => {
          setLiveFormState({
            mode: context.mode,
            editingId: context.editingId,
            code: String(form.code ?? ""),
          });
        }}
        renderFieldAction={({ field, disabled, setValue }) =>
          field.key === "code" ? (
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              onClick={() => setValue(generateShortCode("BR"))}
              title="Auto-generate code"
              type="button"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                <path d="M12 3v4M12 17v4M4.2 7.2l2.8 2.8M17 14l2.8 2.8M3 12h4M17 12h4M4.2 16.8 7 14M17 10l2.8-2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
              </svg>
            </button>
          ) : null
        }
        renderFieldIndicator={({ field }) => {
          if (field.key !== "code") {
            return null;
          }
          if (liveCodeState === "invalid") {
            return (
              <p className="text-xs text-rose-600">
                X Code must be 1 to 8 characters (A-Z, 0-9).
              </p>
            );
          }
          if (liveCodeState === "checking") {
            return (
              <p className="text-xs text-slate-500">Checking code availability...</p>
            );
          }
          if (liveCodeState === "exists") {
            return <p className="text-xs text-rose-600">X Code already exists.</p>;
          }
          if (liveCodeState === "available") {
            return <p className="text-xs text-emerald-600">OK Code is available.</p>;
          }
          return (
            <p className="text-xs text-slate-500">
              If left blank, code is auto-generated.
            </p>
          );
        }}
        transformBeforeSubmit={async (payload, context) => {
          if (isPlatformOwner && !selectedTenantCompanyId) {
            throw new Error("Select a tenant scope first.");
          }
          const normalizedCode = String(payload.code ?? "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
          if (normalizedCode && (normalizedCode.length < 1 || normalizedCode.length > 8)) {
            throw new Error("Branch code must be 1 to 8 characters (A-Z, 0-9).");
          }
          if (normalizedCode) {
            const query = new URLSearchParams();
            query.set("code", normalizedCode);
            if (isPlatformOwner && selectedTenantCompanyId) {
              query.set("companyId", selectedTenantCompanyId);
            }
            if (context.mode === "edit" && context.editingId) {
              query.set("excludeId", context.editingId);
            }
            const existsResult = await apiRequest<{ exists: boolean }>(
              `/master-data/branches/code-exists?${query.toString()}`,
            );
            if (existsResult.exists) {
              throw new Error(`Branch code "${normalizedCode}" already exists.`);
            }
          }
          return {
            ...payload,
            code: normalizedCode,
            companyId: isPlatformOwner
              ? selectedTenantCompanyId || undefined
              : undefined,
          };
        }}
      />
    </div>
  );
}
