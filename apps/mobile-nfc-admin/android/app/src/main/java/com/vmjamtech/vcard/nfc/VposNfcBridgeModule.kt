package com.vmjamtech.vcard.nfc

import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class VposNfcBridgeModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private val tag = "VposNfcBridge"
  private val eventName = "VPOS_NFC_TAG"
  private val nfcAdapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(reactContext)
  @Volatile private var scanning = false

  override fun getName(): String = "VposNfcBridge"

  @ReactMethod
  fun addListener(eventName: String?) {
    // Required for NativeEventEmitter compatibility.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for NativeEventEmitter compatibility.
  }

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    try {
      val map = Arguments.createMap()
      val hasNfcHardware = reactApplicationContext.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC)
      val isNfcEnabled = nfcAdapter?.isEnabled == true
      map.putBoolean("moduleAvailable", true)
      map.putString("platform", "android")
      map.putBoolean("isAndroid", true)
      map.putBoolean("hasNfcHardware", hasNfcHardware)
      map.putBoolean("isNfcEnabled", isNfcEnabled)
      map.putBoolean("isScanning", scanning)
      map.putString("deviceModel", Build.MODEL ?: "Unknown")
      map.putString("deviceManufacturer", Build.MANUFACTURER ?: "Unknown")
      map.putString("deviceBrand", Build.BRAND ?: "Unknown")
      promise.resolve(map)
    } catch (cause: Throwable) {
      Log.e(tag, "getCapabilities failed: ${cause.message}", cause)
      promise.reject("NFC_CAPABILITIES_ERROR", cause.message, cause)
    }
  }

  @ReactMethod
  fun startScan(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("NFC_ACTIVITY_UNAVAILABLE", "Current activity is unavailable.")
      return
    }
    val adapter = nfcAdapter
    if (adapter == null) {
      promise.reject("NFC_UNAVAILABLE", "NFC adapter is unavailable on this device.")
      return
    }
    if (!adapter.isEnabled) {
      promise.reject("NFC_DISABLED", "NFC is disabled on this device.")
      return
    }

    UiThreadUtil.runOnUiThread {
      try {
        val flags =
          NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_NFC_BARCODE or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK

        val options = Bundle().apply {
          putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 200)
        }

        adapter.enableReaderMode(
          activity,
          NfcAdapter.ReaderCallback { detectedTag ->
            emitTag(detectedTag)
          },
          flags,
          options
        )
        scanning = true
        promise.resolve(null)
      } catch (cause: Throwable) {
        Log.e(tag, "startScan failed: ${cause.message}", cause)
        promise.reject("NFC_START_SCAN_ERROR", cause.message, cause)
      }
    }
  }

  @ReactMethod
  fun stopScan(promise: Promise) {
    val activity = currentActivity
    val adapter = nfcAdapter
    if (adapter == null || activity == null) {
      scanning = false
      promise.resolve(null)
      return
    }
    UiThreadUtil.runOnUiThread {
      try {
        adapter.disableReaderMode(activity)
        scanning = false
        promise.resolve(null)
      } catch (cause: Throwable) {
        Log.e(tag, "stopScan failed: ${cause.message}", cause)
        promise.reject("NFC_STOP_SCAN_ERROR", cause.message, cause)
      }
    }
  }

  private fun emitTag(detectedTag: Tag) {
    val payload = Arguments.createMap().apply {
      putString("uidHex", toHex(detectedTag.id))
      val techs = Arguments.createArray()
      detectedTag.techList.forEach { tech ->
        techs.pushString(tech)
      }
      putArray("techList", techs)
      val now = Date()
      putDouble("timestamp", now.time.toDouble())
      putString("timestampIso", iso(now))
    }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, payload)
  }

  private fun toHex(bytes: ByteArray?): String {
    if (bytes == null || bytes.isEmpty()) {
      return ""
    }
    val builder = StringBuilder(bytes.size * 2)
    for (value in bytes) {
      builder.append(String.format("%02X", value))
    }
    return builder.toString()
  }

  private fun iso(date: Date): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)
    return formatter.format(date)
  }
}
