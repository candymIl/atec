export function renderQuickInspection() {
  document.querySelector('#page').innerHTML = `
    <h2>Quick Inspection/Test</h2>

    <div class="filter-card">
      <h3>Scan / Search Asset</h3>

      <label>QR Code, NFC Tag, Asset ID, Serial No, Hoist Serial No or Asset Tag</label>

      <input
        id="quickAssetSearch"
        class="quick-scan-box"
        type="text"
        placeholder="Scan or type here..."
        autofocus
        onkeydown="handleQuickInspectionEnter(event)"
      >

      <div class="quick-scan-actions">
        <button onclick="quickFindAsset()">
          Find Asset
        </button>

        <button type="button" class="qr-scan-btn" onclick="startQuickCameraScan()">
          Scan With Camera
        </button>

        <button type="button" onclick="startQuickNfcScan()">
          Scan NFC Tag
        </button>
      </div>

      <p id="quickNfcStatus" class="nfc-writing-note" hidden></p>

      <div id="quickCameraScanner" class="quick-camera-scanner" hidden>
        <video id="quickCameraVideo" playsinline></video>
        <div class="quick-scan-actions">
          <button type="button" onclick="stopQuickCameraScan()">Stop Scan</button>
        </div>
        <p id="quickScanStatus">Point the camera at the ATEC QR label.</p>
      </div>
    </div>

    <div id="quickInspectionResult"></div>
  `
}
