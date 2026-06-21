export function renderQuickInspection() {
  document.querySelector('#page').innerHTML = `
    <h2>Quick Inspection/Test</h2>

    <div class="filter-card">
      <h3>Scan / Search Asset</h3>

      <label>QR Code, Serial No or Asset Tag</label>

      <input
        id="quickAssetSearch"
        class="quick-scan-box"
        type="text"
        placeholder="Scan or type here..."
        autofocus
        onkeydown="handleQuickInspectionEnter(event)"
      >

      <button onclick="quickFindAsset()">
        Find Asset
      </button>
    </div>

    <div id="quickInspectionResult"></div>
  `
}