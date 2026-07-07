import { getDnsSdApi } from './modules/utils.mjs';
import { ServiceTracker } from './modules/service-tracker.mjs';

// ========== BROWSE FUNCTIONALITY ==========
const serviceTracker = new ServiceTracker();
let browseAbortController = null;

document.getElementById('browse-start').addEventListener('click', async () => {
  const type = document.getElementById('browse-type').value.trim();
  const protocol = document.getElementById('browse-protocol').value;
  const resultsDiv = document.getElementById('browse-results');
  
  if (!type) {
    resultsDiv.innerHTML = '<div style="color: var(--danger);">Please enter a service type</div>';
    return;
  }

  // Start tracking
  serviceTracker.start();
  serviceTracker.updateStatus('Active');
  
  // Enable/disable buttons
  document.getElementById('browse-start').disabled = true;
  document.getElementById('browse-stop').disabled = false;

  // Create abort controller
  browseAbortController = new AbortController();

  try {
    const dnsSd = getDnsSdApi();
    const options = {
      service: { type, protocol },
      signal: browseAbortController.signal
    };

    for await (const serviceRecord of dnsSd.browse(options)) {
      serviceTracker.addOrUpdateService(serviceRecord);
      serviceTracker.render();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      resultsDiv.innerHTML += `<div style="color: var(--danger);">Error: ${err.message}</div>`;
    }
  } finally {
    serviceTracker.stop();
    serviceTracker.updateStatus('Stopped');
    document.getElementById('browse-start').disabled = false;
    document.getElementById('browse-stop').disabled = true;
    browseAbortController = null;
  }
});

document.getElementById('browse-stop').addEventListener('click', () => {
  if (browseAbortController) {
    browseAbortController.abort();
  }
});

// ========== ADVERTISE FUNCTIONALITY ==========
let advertiseHandle = null;

document.getElementById('adv-start').addEventListener('click', async () => {
  const name = document.getElementById('adv-name').value.trim();
  const type = document.getElementById('adv-type').value.trim();
  const protocol = document.getElementById('adv-protocol').value;
  const port = parseInt(document.getElementById('adv-port').value, 10);
  const statusDiv = document.getElementById('adv-status');

  if (!name || !type || !port || port <= 0 || port > 65535) {
    statusDiv.innerHTML = '<div style="color: var(--danger);">Please fill all fields with valid values</div>';
    return;
  }

  statusDiv.innerHTML = '<div>Starting advertisement...</div>';

  try {
    const dnsSd = getDnsSdApi();
    
    const advertiseOptions = {
      service: {
        name,
        type,
        protocol,
        port,
        txt: {
          version: new Uint8Array([1, 0, 0]),
          demo: true
        }
      }
    };
    
    advertiseHandle = await dnsSd.advertise(advertiseOptions);
    
    document.getElementById('adv-status-badge').textContent = 'Active';
    document.getElementById('adv-status-badge').className = 'status-badge active';
    
    statusDiv.innerHTML = `
      <div style="color: var(--success);">✓ Service advertised</div>
      <div style="margin-top: 8px; font-size: 13px; color: var(--text-secondary);">
        <div><strong>Name:</strong> ${name}</div>
        <div><strong>Type:</strong> _${type}._${protocol}.local.</div>
        <div><strong>Port:</strong> ${port}</div>
      </div>
    `;

    document.getElementById('adv-start').disabled = true;
    document.getElementById('adv-stop').disabled = false;
  } catch (err) {
    statusDiv.innerHTML = `<div style="color: var(--danger);">Error: ${err.message}</div>`;
  }
});

document.getElementById('adv-stop').addEventListener('click', async () => {
  const statusDiv = document.getElementById('adv-status');

  if (advertiseHandle) {
    try {
      await advertiseHandle.stop();
      
      document.getElementById('adv-status-badge').textContent = 'Idle';
      document.getElementById('adv-status-badge').className = 'status-badge';
      
      statusDiv.innerHTML = '<div>Advertisement stopped.</div>';
      advertiseHandle = null;
      document.getElementById('adv-start').disabled = false;
      document.getElementById('adv-stop').disabled = true;
    } catch (err) {
      statusDiv.innerHTML += `<div style="color: var(--danger);">Error stopping: ${err.message}</div>`;
    }
  }
});

// ========== INITIALIZATION ==========
document.getElementById('browse-results').innerHTML = '<div style="color: #999;">Click "Start Browse" to discover services on the network.</div>';
document.getElementById('adv-status').innerHTML = '<div style="color: #999;">Click "Start Advertise" to publish a service.</div>';

serviceTracker.updateStatus('Idle');

// Display platform info
const userAgent = navigator.userAgent;
let platformName = 'Unknown';

if (userAgent.includes('Mac')) platformName = 'macOS';
else if (userAgent.includes('Win')) platformName = 'Windows';
else if (userAgent.includes('Linux')) platformName = 'Linux';
else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) platformName = 'iOS';
else if (userAgent.includes('Android')) platformName = 'Android';

document.getElementById('platform-info').textContent = platformName;
