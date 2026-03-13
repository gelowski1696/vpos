import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { AppTheme } from "../theme";

type Props = {
  visible: boolean;
  theme: AppTheme;
  busy?: boolean;
  onClose: () => void;
  onTokenDetected: (token: string) => void;
};

function readEnrollmentToken(raw: string): string | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(normalized);
    const directMatch = decoded.match(/[?&](?:token|setup_token)=([^&]+)/i);
    if (directMatch?.[1]) {
      return directMatch[1];
    }
    const pathMatch = decoded.match(/\/enroll\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
    const tokenLike = decoded.match(/^[A-Za-z0-9._~-]{24,}$/);
    if (tokenLike) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

export function EnrollmentScannerModal({
  visible,
  theme,
  busy = false,
  onClose,
  onTokenDetected,
}: Props): JSX.Element | null {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setScanLocked(false);
    setManualInput("");
    setInlineError(null);
  }, [visible]);

  const canSubmitManual = useMemo(() => manualInput.trim().length > 0 && !busy, [manualInput, busy]);

  if (!visible) {
    return null;
  }

  const handleDetectedPayload = (payload: string): void => {
    const token = readEnrollmentToken(payload);
    if (!token) {
      setInlineError("QR does not contain a valid setup token.");
      return;
    }
    setInlineError(null);
    setScanLocked(true);
    onTokenDetected(token);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.card, borderColor: theme.cardBorder },
          ]}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: theme.heading }]}>Scan Setup QR</Text>
            <Pressable
              disabled={busy}
              onPress={onClose}
              style={[
                styles.closeBtn,
                { borderColor: theme.cardBorder, backgroundColor: theme.pillBg },
              ]}
            >
              <Text style={[styles.closeBtnText, { color: theme.pillText }]}>Close</Text>
            </Pressable>
          </View>

          {!permission?.granted ? (
            <View style={styles.permissionWrap}>
              <Text style={[styles.hint, { color: theme.subtext }]}>
                Camera access is required to scan the setup QR.
              </Text>
              <Pressable
                disabled={busy}
                onPress={() => {
                  void requestPermission();
                }}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: busy ? theme.primaryMuted : theme.primary },
                ]}
              >
                <Text style={styles.primaryBtnText}>Allow Camera</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={
                  busy || scanLocked
                    ? undefined
                    : ({ data }) => {
                        handleDetectedPayload(String(data ?? ""));
                      }
                }
              />
              <View pointerEvents="none" style={styles.scanFrameWrap}>
                <View style={[styles.scanFrame, { borderColor: theme.primary }]} />
              </View>
            </View>
          )}

          <Text style={[styles.hint, { color: theme.subtext }]}>
            If camera scan is not possible, paste setup link/token below.
          </Text>
          <TextInput
            value={manualInput}
            editable={!busy}
            onChangeText={setManualInput}
            placeholder="vpos://enroll?token=..."
            placeholderTextColor={theme.inputPlaceholder}
            style={[
              styles.input,
              { backgroundColor: theme.inputBg, color: theme.inputText, borderColor: theme.cardBorder },
            ]}
          />
          <View style={styles.footerActions}>
            <Pressable
              disabled={!canSubmitManual}
              onPress={() => handleDetectedPayload(manualInput)}
              style={[
                styles.primaryBtn,
                { backgroundColor: canSubmitManual ? theme.primary : theme.primaryMuted },
              ]}
            >
              <Text style={styles.primaryBtnText}>Use Token</Text>
            </Pressable>
          </View>

          {inlineError ? (
            <Text style={styles.errorText}>{inlineError}</Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.72)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 10,
    minHeight: "72%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
  },
  closeBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  permissionWrap: {
    gap: 8,
    minHeight: 120,
    justifyContent: "center",
  },
  cameraWrap: {
    height: 280,
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  camera: {
    flex: 1,
  },
  scanFrameWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  scanFrame: {
    width: 210,
    height: 210,
    borderWidth: 2,
    borderRadius: 16,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  footerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  primaryBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  errorText: {
    fontSize: 12,
    color: "#fca5a5",
  },
});

