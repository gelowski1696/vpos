#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::AppHandle;
use tauri::Manager;
#[cfg(target_os = "windows")]
use windows::{
    core::{w, PWSTR},
    Win32::Foundation::HANDLE,
    Win32::Graphics::Printing::{
        ClosePrinter, DOC_INFO_1W, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter,
    },
    Win32::Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC, SND_NODEFAULT},
    Win32::System::Diagnostics::Debug::Beep,
};

const STATE_KEY: &str = "desktop_app_state";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct DesktopSetupPayload {
    operator_name: String,
    client_id: String,
    auth_email: String,
    device_id: String,
    branch_id: String,
    branch_label: String,
    location_id: String,
    location_label: String,
    api_base_url: String,
    printer_mode: String,
    printer_name: String,
    printer_host: String,
    printer_port: String,
    #[serde(default = "default_pos_lpg_flow")]
    pos_default_lpg_flow: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct DesktopAuthPayload {
    access_token: Option<String>,
    refresh_token: Option<String>,
    signed_in_at: Option<String>,
    #[serde(default)]
    user_email: Option<String>,
    #[serde(default)]
    user_full_name: Option<String>,
    #[serde(default)]
    pin_hash: Option<String>,
    #[serde(default)]
    pin_salt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct DesktopPrinterProfilePayload {
    id: String,
    label: String,
    mode: String,
    printer_name: String,
    printer_host: String,
    printer_port: String,
    #[serde(default)]
    last_tested_at: Option<String>,
    #[serde(default)]
    last_success_at: Option<String>,
    #[serde(default = "default_last_test_status")]
    last_test_status: String,
    #[serde(default)]
    last_test_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopSyncPayload {
    last_synced_at: Option<String>,
    #[serde(default)]
    last_pull_token: Option<String>,
    last_sync_status: String,
    last_sync_message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopAppStatePayload {
    version: i64,
    setup_completed: bool,
    #[serde(default)]
    setup: DesktopSetupPayload,
    #[serde(default)]
    auth: DesktopAuthPayload,
    #[serde(default)]
    printer_profiles: Vec<DesktopPrinterProfilePayload>,
    #[serde(default = "default_json_object")]
    receipt_layout: serde_json::Value,
    #[serde(default = "default_json_object")]
    walkthrough: serde_json::Value,
    sync: DesktopSyncPayload,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopMasterDataRowPayload {
    entity: String,
    record_id: String,
    payload: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopSaleLinePayload {
    #[serde(default)]
    line_id: Option<String>,
    product_id: String,
    product_name: String,
    #[serde(default)]
    subtitle: Option<String>,
    quantity: f64,
    unit_price: f64,
    line_total: f64,
    #[serde(default)]
    cylinder_flow: Option<String>,
    #[serde(flatten, default)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopSalePayload {
    id: String,
    customer_id: Option<String>,
    customer_name: Option<String>,
    sale_type: String,
    payment_method: String,
    branch_label: String,
    location_label: String,
    subtotal: f64,
    discount_amount: f64,
    total_amount: f64,
    notes: Option<String>,
    lines: Vec<DesktopSaleLinePayload>,
    created_at: String,
    #[serde(flatten, default)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopSaleRecordPayload {
    id: String,
    payload: DesktopSalePayload,
    sync_status: String,
    receipt_number: String,
    created_at: String,
    updated_at: String,
    #[serde(flatten, default)]
    extra: serde_json::Map<String, serde_json::Value>,
}

fn deserialize_sale_record_payload(
    id: String,
    payload_raw: &str,
    sync_status: String,
    receipt_number: String,
    created_at: String,
    updated_at: String,
) -> Result<DesktopSaleRecordPayload, String> {
    if let Ok(mut record) = serde_json::from_str::<DesktopSaleRecordPayload>(payload_raw) {
        record.id = id;
        record.sync_status = sync_status;
        record.receipt_number = receipt_number;
        record.created_at = created_at;
        record.updated_at = updated_at;
        return Ok(record);
    }

    let payload =
        serde_json::from_str::<DesktopSalePayload>(payload_raw).map_err(|err| err.to_string())?;
    Ok(DesktopSaleRecordPayload {
        id,
        payload,
        sync_status,
        receipt_number,
        created_at,
        updated_at,
        extra: serde_json::Map::new(),
    })
}

fn serialize_sale_record_payload(sale: &DesktopSaleRecordPayload) -> Result<String, String> {
    serde_json::to_string(sale).map_err(|err| err.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopOutboxItemPayload {
    id: String,
    entity: String,
    action: String,
    payload: serde_json::Value,
    idempotency_key: String,
    status: String,
    retry_count: i64,
    last_error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopOutboxInputPayload {
    id: String,
    entity: String,
    action: String,
    payload: serde_json::Value,
    idempotency_key: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReceiptLinePayload {
    align: Option<String>,
    text: String,
    emphasis: Option<bool>,
    image_base64: Option<String>,
    image_width: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PrinterConfigPayload {
    mode: Option<String>,
    printer_name: Option<String>,
    printer_host: Option<String>,
    printer_port: Option<u16>,
}

fn default_state() -> DesktopAppStatePayload {
    DesktopAppStatePayload {
        version: 1,
        setup_completed: false,
        setup: DesktopSetupPayload {
            operator_name: String::new(),
            client_id: String::new(),
            auth_email: String::new(),
            device_id: "desktop-vpos".to_string(),
            branch_id: String::new(),
            branch_label: String::new(),
            location_id: String::new(),
            location_label: String::new(),
            api_base_url: "https://vmjamtech.com/api".to_string(),
            printer_mode: "USB".to_string(),
            printer_name: String::new(),
            printer_host: String::new(),
            printer_port: "9100".to_string(),
            pos_default_lpg_flow: default_pos_lpg_flow(),
        },
        auth: DesktopAuthPayload {
            access_token: None,
            refresh_token: None,
            signed_in_at: None,
            user_email: None,
            user_full_name: None,
            pin_hash: None,
            pin_salt: None,
        },
        printer_profiles: Vec::new(),
        receipt_layout: default_json_object(),
        walkthrough: default_json_object(),
        sync: DesktopSyncPayload {
            last_synced_at: None,
            last_pull_token: None,
            last_sync_status: "idle".to_string(),
            last_sync_message: "Desktop setup has not been completed yet.".to_string(),
        },
    }
}

fn default_last_test_status() -> String {
    "idle".to_string()
}

fn default_pos_lpg_flow() -> String {
    "NONE".to_string()
}

fn default_json_object() -> serde_json::Value {
    serde_json::json!({})
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resolver = app.path_resolver();
    let mut dir = resolver
        .app_local_data_dir()
        .ok_or_else(|| "Unable to resolve app local data directory".to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    dir.push("vpos-desktop.db");
    Ok(dir)
}

fn connection(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|err| err.to_string())?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS outbox_items (
          id TEXT PRIMARY KEY,
          entity TEXT NOT NULL,
          action TEXT NOT NULL,
          payload TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          status TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sales_local (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          sync_status TEXT NOT NULL,
          receipt_number TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS master_data_local (
          entity TEXT NOT NULL,
          record_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(entity, record_id)
        );

        CREATE INDEX IF NOT EXISTS idx_outbox_items_status_created_at
        ON outbox_items(status, created_at);

        CREATE INDEX IF NOT EXISTS idx_sales_local_created_at
        ON sales_local(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_master_data_local_entity_updated_at
        ON master_data_local(entity, updated_at DESC);
        "#,
    )
    .map_err(|err| err.to_string())?;
    Ok(conn)
}

fn load_state_internal(app: &AppHandle) -> Result<DesktopAppStatePayload, String> {
    let conn = connection(app)?;
    let mut stmt = conn
        .prepare("SELECT value FROM app_meta WHERE key = ?1")
        .map_err(|err| err.to_string())?;
    let value = stmt.query_row(params![STATE_KEY], |row| row.get::<_, String>(0));
    match value {
        Ok(raw) => serde_json::from_str::<DesktopAppStatePayload>(&raw).map_err(|err| err.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let state = default_state();
            save_state_internal(app, state.clone())?;
            Ok(state)
        }
        Err(err) => Err(err.to_string()),
    }
}

fn save_state_internal(app: &AppHandle, state: DesktopAppStatePayload) -> Result<DesktopAppStatePayload, String> {
    let conn = connection(app)?;
    let raw = serde_json::to_string(&state).map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT INTO app_meta(key, value, updated_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![STATE_KEY, raw, now_iso()],
    )
    .map_err(|err| err.to_string())?;
    Ok(state)
}

fn build_esc_pos_bytes(lines: &[ReceiptLinePayload]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&[0x1b, 0x40]);

    for line in lines {
        let align = match line.align.as_deref() {
            Some("center") => 1,
            Some("right") => 2,
            _ => 0,
        };
        bytes.extend_from_slice(&[0x1b, 0x61, align]);
        bytes.extend_from_slice(&[0x1b, 0x45, if line.emphasis.unwrap_or(false) { 1 } else { 0 }]);
        bytes.extend_from_slice(line.text.as_bytes());
        bytes.push(b'\n');
    }

    bytes.extend_from_slice(&[0x1b, 0x45, 0]);
    bytes.extend_from_slice(&[0x1d, 0x56, 0x00]);
    bytes
}

fn print_lan_raw(host: &str, port: u16, bytes: &[u8]) -> Result<(), String> {
    let address = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(address).map_err(|err| err.to_string())?;
    stream.write_all(bytes).map_err(|err| err.to_string())?;
    stream.flush().map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn print_usb_raw(printer_name: &str, bytes: &[u8]) -> Result<(), String> {
    if printer_name.trim().is_empty() {
        return Err("USB printer name is required for desktop receipt printing.".to_string());
    }

    let printer_name_w = to_wide(printer_name);
    let doc_name_w = to_wide("VPOS Desktop Receipt");
    let raw_w = to_wide("RAW");

    unsafe {
        let mut handle = HANDLE::default();
        OpenPrinterW(PWSTR(printer_name_w.as_ptr() as *mut _), &mut handle, None)
            .map_err(|_| "Unable to open the selected Windows printer.".to_string())?;

        let doc_info = DOC_INFO_1W {
            pDocName: PWSTR(doc_name_w.as_ptr() as *mut _),
            pOutputFile: PWSTR::null(),
            pDatatype: PWSTR(raw_w.as_ptr() as *mut _),
        };

        if StartDocPrinterW(handle, 1, &doc_info as *const _) == 0 {
            let _ = ClosePrinter(handle);
            return Err("Unable to start a RAW print job on the selected Windows printer.".to_string());
        }

        if !StartPagePrinter(handle).as_bool() {
            let _ = EndDocPrinter(handle);
            let _ = ClosePrinter(handle);
            return Err("Unable to start the desktop printer page.".to_string());
        }

        let mut written = 0u32;
        if !WritePrinter(handle, bytes.as_ptr() as *const _, bytes.len() as u32, &mut written).as_bool() {
            let _ = EndPagePrinter(handle);
            let _ = EndDocPrinter(handle);
            let _ = ClosePrinter(handle);
            return Err("Unable to write receipt bytes to the selected Windows printer.".to_string());
        }

        let _ = EndPagePrinter(handle);
        let _ = EndDocPrinter(handle);
        let _ = ClosePrinter(handle);
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn print_usb_raw(_printer_name: &str, _bytes: &[u8]) -> Result<(), String> {
    Err("USB printer transport is currently supported only on Windows desktop builds.".to_string())
}

fn print_bytes(config: PrinterConfigPayload, bytes: &[u8]) -> Result<(), String> {
    let mode = config.mode.unwrap_or_else(|| "NONE".to_string()).to_uppercase();
    match mode.as_str() {
        "USB" => print_usb_raw(&config.printer_name.unwrap_or_default(), bytes),
        "LAN" => {
            let host = config.printer_host.unwrap_or_default();
            let port = config.printer_port.unwrap_or(9100);
            if host.trim().is_empty() {
                return Err("LAN printer host is required for desktop receipt printing.".to_string());
            }
            print_lan_raw(&host, port, bytes)
        }
        _ => Err("No desktop printer path is configured yet.".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn list_system_printers() -> Result<Vec<String>, String> {
    let script = r#"
$printerRows = @()
try {
  $printerRows += Get-Printer | Select-Object Name, PortName, Type, DriverName, Shared
} catch {}
try {
  $printerRows += Get-CimInstance Win32_Printer | Select-Object Name, PortName, DriverName, Local, Network
} catch {}

$virtualNames = @(
  'Microsoft Print to PDF',
  'Microsoft XPS Document Writer',
  'Fax',
  'OneNote',
  'Send To OneNote'
)

$normalized = $printerRows |
  Where-Object { $_.Name } |
  Group-Object -Property Name |
  ForEach-Object {
    $sample = $_.Group | Select-Object -First 1
    $portName = [string]$sample.PortName
    $name = [string]$sample.Name
    $type = [string]$sample.Type
    $isUsb = $portName -match '^(USB|DOT4|LPT)'
    $isLocal = ($type -eq 'Local') -or ($sample.Local -eq $true)
    $isVirtual = $virtualNames -contains $name
    [PSCustomObject]@{
      Name = $name
      IsUsb = $isUsb
      IsLocal = $isLocal
      IsVirtual = $isVirtual
    }
  }

$preferred = $normalized |
  Sort-Object -Property `
    @{ Expression = { if ($_.IsUsb) { 0 } else { 1 } } }, `
    @{ Expression = { if ($_.IsLocal) { 0 } else { 1 } } }, `
    @{ Expression = { if ($_.IsVirtual) { 1 } else { 0 } } }, `
    Name

$filtered = $preferred | Where-Object { -not $_.IsVirtual } | Select-Object -ExpandProperty Name
if (-not $filtered) {
  $filtered = $preferred | Select-Object -ExpandProperty Name
}

$filtered
"#;

    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-Command", script]);
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|err| err.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Unable to discover installed Windows printers.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect())
}

#[cfg(not(target_os = "windows"))]
fn list_system_printers() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[tauri::command]
fn desktop_ready() -> &'static str {
    "VPOS Desktop ready"
}

#[tauri::command]
fn desktop_load_state(app: AppHandle) -> Result<DesktopAppStatePayload, String> {
    load_state_internal(&app)
}

#[tauri::command]
fn desktop_save_state(app: AppHandle, state: DesktopAppStatePayload) -> Result<DesktopAppStatePayload, String> {
    save_state_internal(&app, state)
}

#[tauri::command]
fn desktop_list_sales(app: AppHandle) -> Result<Vec<DesktopSaleRecordPayload>, String> {
    let conn = connection(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, payload, sync_status, receipt_number, created_at, updated_at
             FROM sales_local
             ORDER BY created_at DESC",
        )
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let payload_raw: String = row.get(1)?;
            deserialize_sale_record_payload(
                row.get(0)?,
                &payload_raw,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            )
            .map_err(|err| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    err,
                )))
            })
        })
        .map_err(|err| err.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|err| err.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
fn desktop_save_sale(app: AppHandle, sale: DesktopSaleRecordPayload) -> Result<DesktopSaleRecordPayload, String> {
    let conn = connection(&app)?;
    let payload_raw = serialize_sale_record_payload(&sale)?;
    conn.execute(
        "INSERT INTO sales_local(id, payload, sync_status, receipt_number, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           sync_status = excluded.sync_status,
           receipt_number = excluded.receipt_number,
           updated_at = excluded.updated_at",
        params![
            sale.id,
            payload_raw,
            sale.sync_status,
            sale.receipt_number,
            sale.created_at,
            sale.updated_at
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(sale)
}

#[tauri::command]
fn desktop_mark_sale_sync_status(
    app: AppHandle,
    id: String,
    sync_status: String,
) -> Result<(), String> {
    let conn = connection(&app)?;
    conn.execute(
        "UPDATE sales_local SET sync_status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, sync_status, now_iso()],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_list_master_data(
    app: AppHandle,
    entity: Option<String>,
) -> Result<Vec<DesktopMasterDataRowPayload>, String> {
    let conn = connection(&app)?;
    let mut result = Vec::new();
    if let Some(value) = entity {
        if !value.trim().is_empty() {
            let mut stmt = conn
                .prepare(
                    "SELECT entity, record_id, payload, updated_at
                     FROM master_data_local
                     WHERE entity = ?1
                     ORDER BY updated_at DESC, record_id ASC",
                )
                .map_err(|err| err.to_string())?;
            let rows = stmt
                .query_map(params![value], |row| {
                    Ok(DesktopMasterDataRowPayload {
                        entity: row.get(0)?,
                        record_id: row.get(1)?,
                        payload: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                })
                .map_err(|err| err.to_string())?;
            for row in rows {
                result.push(row.map_err(|err| err.to_string())?);
            }
            return Ok(result);
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT entity, record_id, payload, updated_at
             FROM master_data_local
             ORDER BY entity ASC, updated_at DESC, record_id ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(DesktopMasterDataRowPayload {
                entity: row.get(0)?,
                record_id: row.get(1)?,
                payload: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|err| err.to_string())?;
    for row in rows {
        result.push(row.map_err(|err| err.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
fn desktop_replace_master_data_entity(
    app: AppHandle,
    entity: String,
    rows: Vec<DesktopMasterDataRowPayload>,
) -> Result<(), String> {
    let mut conn = connection(&app)?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM master_data_local WHERE entity = ?1", params![entity.clone()])
        .map_err(|err| err.to_string())?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO master_data_local(entity, record_id, payload, updated_at)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(entity, record_id) DO UPDATE SET
                   payload = excluded.payload,
                   updated_at = excluded.updated_at",
            )
            .map_err(|err| err.to_string())?;

        for row in rows {
            stmt.execute(params![entity.as_str(), row.record_id, row.payload, row.updated_at])
                .map_err(|err| err.to_string())?;
        }
    }

    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_upsert_master_data_rows(
    app: AppHandle,
    rows: Vec<DesktopMasterDataRowPayload>,
) -> Result<(), String> {
    let mut conn = connection(&app)?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO master_data_local(entity, record_id, payload, updated_at)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(entity, record_id) DO UPDATE SET
                   payload = excluded.payload,
                   updated_at = excluded.updated_at",
            )
            .map_err(|err| err.to_string())?;

        for row in rows {
            stmt.execute(params![row.entity, row.record_id, row.payload, row.updated_at])
                .map_err(|err| err.to_string())?;
        }
    }

    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_delete_master_data_row(
    app: AppHandle,
    entity: String,
    record_id: String,
) -> Result<(), String> {
    let conn = connection(&app)?;
    conn.execute(
        "DELETE FROM master_data_local WHERE entity = ?1 AND record_id = ?2",
        params![entity, record_id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_list_outbox(app: AppHandle) -> Result<Vec<DesktopOutboxItemPayload>, String> {
    let conn = connection(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, entity, action, payload, idempotency_key, status, retry_count, last_error, created_at, updated_at
             FROM outbox_items
             ORDER BY created_at DESC",
        )
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let payload_raw: String = row.get(3)?;
            let payload = serde_json::from_str::<serde_json::Value>(&payload_raw)
                .unwrap_or_else(|_| serde_json::json!({}));
            Ok(DesktopOutboxItemPayload {
                id: row.get(0)?,
                entity: row.get(1)?,
                action: row.get(2)?,
                payload,
                idempotency_key: row.get(4)?,
                status: row.get(5)?,
                retry_count: row.get(6)?,
                last_error: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|err| err.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|err| err.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
fn desktop_enqueue_outbox_item(
    app: AppHandle,
    input: DesktopOutboxInputPayload,
) -> Result<DesktopOutboxItemPayload, String> {
    let conn = connection(&app)?;
    let payload_raw = serde_json::to_string(&input.payload).map_err(|err| err.to_string())?;
    let timestamp = now_iso();
    conn.execute(
        "INSERT INTO outbox_items(id, entity, action, payload, idempotency_key, status, retry_count, last_error, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, 'pending', 0, NULL, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           entity = excluded.entity,
           action = excluded.action,
           payload = excluded.payload,
           idempotency_key = excluded.idempotency_key,
           updated_at = excluded.updated_at",
        params![
            input.id,
            input.entity,
            input.action,
            payload_raw,
            input.idempotency_key,
            input.created_at,
            timestamp
        ],
    )
    .map_err(|err| err.to_string())?;

    Ok(DesktopOutboxItemPayload {
        id: input.id,
        entity: input.entity,
        action: input.action,
        payload: input.payload,
        idempotency_key: input.idempotency_key,
        status: "pending".to_string(),
        retry_count: 0,
        last_error: None,
        created_at: input.created_at,
        updated_at: timestamp,
    })
}

#[tauri::command]
fn desktop_mark_outbox_status(
    app: AppHandle,
    id: String,
    status: String,
    last_error: Option<String>,
) -> Result<(), String> {
    let conn = connection(&app)?;
    conn.execute(
        "UPDATE outbox_items SET status = ?2, last_error = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, status, last_error, now_iso()],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_increment_outbox_retry(app: AppHandle, id: String, error: String) -> Result<(), String> {
    let conn = connection(&app)?;
    conn.execute(
        "UPDATE outbox_items
         SET retry_count = retry_count + 1, status = 'failed', last_error = ?2, updated_at = ?3
         WHERE id = ?1",
        params![id, error, now_iso()],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_update_outbox_payload(
    app: AppHandle,
    id: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let conn = connection(&app)?;
    conn.execute(
        "UPDATE outbox_items SET payload = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, payload.to_string(), now_iso()],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_delete_outbox_item(app: AppHandle, id: String) -> Result<(), String> {
    let conn = connection(&app)?;
    conn.execute("DELETE FROM outbox_items WHERE id = ?1", params![id])
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_reset_local_data(app: AppHandle) -> Result<(), String> {
    let mut conn = connection(&app)?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM outbox_items", [])
        .map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM sales_local", [])
        .map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM master_data_local", [])
        .map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM app_meta", [])
        .map_err(|err| err.to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_print_esc_pos(lines: Vec<ReceiptLinePayload>, config: Option<PrinterConfigPayload>) -> Result<(), String> {
    let bytes = build_esc_pos_bytes(&lines);
    let resolved = config.unwrap_or(PrinterConfigPayload {
        mode: Some("NONE".to_string()),
        printer_name: None,
        printer_host: None,
        printer_port: Some(9100),
    });
    print_bytes(resolved, &bytes)
}

#[tauri::command]
fn desktop_list_printers() -> Result<Vec<String>, String> {
    list_system_printers()
}

#[tauri::command]
fn desktop_play_startup_sound() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(|| {
            unsafe {
                let played = PlaySoundW(
                    w!("SystemAsterisk"),
                    None,
                    SND_ALIAS | SND_ASYNC | SND_NODEFAULT,
                )
                .as_bool();

                if !played {
                    let sequence = [(740u32, 55u32), (988u32, 72u32), (1175u32, 48u32)];
                    for (frequency, duration) in sequence {
                        let _ = Beep(frequency, duration);
                    }
                }
            }
        });
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sale_payload_roundtrip_preserves_lpg_line_flow_fields_and_partial_payment_mode() {
        let payload_json = r#"
        {
          "id": "sale-1",
          "shiftId": "shift-1",
          "customerId": null,
          "customerName": null,
          "saleType": "PICKUP",
          "paymentMode": "PARTIAL",
          "paymentMethod": "CASH",
          "branchLabel": "VMJAM - Desktop",
          "locationLabel": "VMJAM - Desktop Primary",
          "subtotal": 50,
          "discountAmount": 0,
          "totalAmount": 50,
          "paidAmount": 20,
          "creditBalance": 30,
          "payments": [
            {
              "id": "sale-1-payment-1",
              "source": "SALE",
              "method": "CASH",
              "amount": 20,
              "createdAt": "2026-06-05T00:00:00.000Z"
            }
          ],
          "notes": null,
          "lines": [
            {
              "productId": "product-1",
              "productName": "Cylinder A",
              "quantity": 1,
              "unitPrice": 50,
              "lineTotal": 50,
              "subtitle": "Refill | 5 kg",
              "cylinderFlow": "REFILL_EXCHANGE"
            }
          ],
          "createdAt": "2026-06-05T00:00:00.000Z"
        }
        "#;

        let payload: DesktopSalePayload =
            serde_json::from_str(payload_json).expect("sale payload should deserialize");
        let serialized = serde_json::to_value(&payload).expect("sale payload should serialize");
        let line = &serialized["lines"][0];

        assert_eq!(serialized["shiftId"], "shift-1");
        assert_eq!(serialized["paymentMode"], "PARTIAL");
        assert_eq!(serialized["paidAmount"], 20.0);
        assert_eq!(serialized["creditBalance"], 30.0);
        assert_eq!(serialized["payments"][0]["source"], "SALE");
        assert_eq!(line["subtitle"], "Refill | 5 kg");
        assert_eq!(line["cylinderFlow"], "REFILL_EXCHANGE");
    }

    #[test]
    fn sale_record_roundtrip_preserves_cancel_status_fields() {
        let record_json = r#"
        {
          "id": "sale-1",
          "syncStatus": "pending",
          "receiptNumber": "RCP-0001",
          "createdAt": "2026-06-10T00:00:00.000Z",
          "updatedAt": "2026-06-10T00:01:00.000Z",
          "saleStatus": "CANCELLED",
          "cancelReason": "Customer requested cancellation",
          "cancelledAt": "2026-06-10T00:01:00.000Z",
          "payload": {
            "id": "sale-1",
            "customerId": "cust-1",
            "customerName": "Customer One",
            "saleType": "PICKUP",
            "paymentMethod": "CASH",
            "paymentMode": "FULL",
            "branchLabel": "VMJAM - Desktop",
            "locationLabel": "VMJAM - Desktop Primary",
            "subtotal": 50,
            "discountAmount": 0,
            "totalAmount": 50,
            "notes": null,
            "lines": [],
            "createdAt": "2026-06-10T00:00:00.000Z"
          }
        }
        "#;

        let record: DesktopSaleRecordPayload =
            serde_json::from_str(record_json).expect("sale record should deserialize");
        let raw = serialize_sale_record_payload(&record).expect("sale record should serialize");
        let restored = deserialize_sale_record_payload(
            "sale-1".to_string(),
            &raw,
            "pending".to_string(),
            "RCP-0001".to_string(),
            "2026-06-10T00:00:00.000Z".to_string(),
            "2026-06-10T00:01:00.000Z".to_string(),
        )
        .expect("sale record should restore");

        let serialized = serde_json::to_value(&restored).expect("restored record should serialize");
        assert_eq!(serialized["saleStatus"], "CANCELLED");
        assert_eq!(serialized["cancelReason"], "Customer requested cancellation");
        assert_eq!(serialized["cancelledAt"], "2026-06-10T00:01:00.000Z");
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_window("main") {
                let _ = window.maximize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_ready,
            desktop_load_state,
            desktop_save_state,
            desktop_list_sales,
            desktop_save_sale,
            desktop_mark_sale_sync_status,
            desktop_list_master_data,
            desktop_replace_master_data_entity,
            desktop_upsert_master_data_rows,
            desktop_delete_master_data_row,
            desktop_list_outbox,
            desktop_enqueue_outbox_item,
            desktop_mark_outbox_status,
            desktop_increment_outbox_retry,
            desktop_update_outbox_payload,
            desktop_delete_outbox_item,
            desktop_reset_local_data,
            desktop_print_esc_pos,
            desktop_list_printers,
            desktop_play_startup_sound
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
