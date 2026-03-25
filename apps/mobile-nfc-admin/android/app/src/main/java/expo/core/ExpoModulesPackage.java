package expo.core;

// Compatibility shim for generated autolinking code that references the legacy
// expo.core.ExpoModulesPackage symbol.
public class ExpoModulesPackage implements com.facebook.react.ReactPackage {
  private final expo.modules.ExpoModulesPackage delegate = new expo.modules.ExpoModulesPackage();

  @Override
  public java.util.List<com.facebook.react.bridge.NativeModule> createNativeModules(
      com.facebook.react.bridge.ReactApplicationContext reactContext) {
    return delegate.createNativeModules(reactContext);
  }

  @SuppressWarnings({"rawtypes", "unchecked"})
  @Override
  public java.util.List<com.facebook.react.uimanager.ViewManager> createViewManagers(
      com.facebook.react.bridge.ReactApplicationContext reactContext) {
    return (java.util.List) delegate.createViewManagers(reactContext);
  }
}
