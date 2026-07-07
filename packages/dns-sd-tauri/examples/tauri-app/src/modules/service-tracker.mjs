/**
 * Service tracking and rendering for browse functionality
 */
import { formatAddresses, formatTxtRecords, formatTime } from './utils.mjs';

export class ServiceTracker {
  constructor() {
    this.services = new Map();
    this.serviceDomIds = new Map();
    this.startTime = null;
    this.timerInterval = null;
  }

  start() {
    this.services.clear();
    this.startTime = performance.now();
    this.updateStats();
    this.startTimer();
  }

  stop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  addOrUpdateService(serviceRecord) {
    const key = serviceRecord.fullName;

    // A `removed` event (isActive:false) means the instance went away.
    if (serviceRecord.kind === 'removed' || serviceRecord.isActive === false) {
      this.services.delete(key);
      return { isNew: false, discoveryTime: null, removed: true };
    }

    const isNew = !this.services.has(key);
    const discoveryTime = isNew ? performance.now() - this.startTime : null;

    this.services.set(key, {
      ...serviceRecord,
      discoveryTime,
      expanded: this.services.get(key)?.expanded ?? false,
    });

    return { isNew, discoveryTime, removed: false };
  }

  getService(fullName) {
    return this.services.get(fullName);
  }

  getDomId(fullName) {
    let existing = this.serviceDomIds.get(fullName);
    if (existing) return existing;

    let hash = 0;
    for (let i = 0; i < fullName.length; i += 1) {
      hash = ((hash << 5) - hash + fullName.charCodeAt(i)) | 0;
    }
    existing = `svc-${Math.abs(hash).toString(36)}`;
    this.serviceDomIds.set(fullName, existing);
    return existing;
  }

  toggleExpand(fullName) {
    const service = this.services.get(fullName);
    if (service) {
      service.expanded = !service.expanded;
    }
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      this.updateStats();
    }, 100);
  }

  updateStats() {
    const elapsed = this.startTime ? (performance.now() - this.startTime) / 1000 : 0;
    const count = this.services.size;
    
    document.getElementById('browse-count').textContent = count;
    document.getElementById('browse-elapsed').textContent = `${elapsed.toFixed(1)}s`;
  }

  updateStatus(status) {
    const badge = document.getElementById('browse-status');
    badge.textContent = status;
    badge.className = 'status-badge';
    
    if (status === 'Active') {
      badge.classList.add('active');
    } else if (status === 'Stopped') {
      badge.classList.add('stopped');
    }
  }

  render() {
    const resultsDiv = document.getElementById('browse-results');
    const serviceList = Array.from(this.services.values());

    if (serviceList.length === 0) {
      resultsDiv.innerHTML = '<div style="color: #999;">No services found yet...</div>';
      return;
    }

    resultsDiv.innerHTML = serviceList
      .map(svc => this.renderService(svc))
      .join('');

    // Add click handlers for expansion
    serviceList.forEach(svc => {
      const header = document.getElementById(`service-header-${this.getDomId(svc.fullName)}`);
      if (header) {
        header.onclick = () => {
          this.toggleExpand(svc.fullName);
          this.render();
        };
      }
    });
  }

  renderService(svc) {
    const isExpanded = svc.expanded;
    const discoveryTimeStr = svc.discoveryTime ? formatTime(svc.discoveryTime) : '';
    const domId = this.getDomId(svc.fullName);

    return `
      <div class="service-item">
        <div class="service-header" id="service-header-${domId}">
          <div class="service-name-row">
            <span class="service-name">${svc.name}</span>
            ${svc.kind ? `<span class="kind-badge">${svc.kind}</span>` : ''}
            ${discoveryTimeStr ? `<span class="discovery-time">Found in ${discoveryTimeStr}</span>` : ''}
            ${!svc.isActive ? '<span class="inactive-badge">Inactive</span>' : ''}
          </div>
          <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▸</span>
        </div>
        <div class="service-details ${isExpanded ? 'expanded' : ''}">
          <div class="service-detail"><strong>Type:</strong> ${svc.serviceType}</div>
          <div class="service-detail"><strong>Host:</strong> ${svc.host || 'N/A'}</div>
          <div class="service-detail"><strong>Port:</strong> ${svc.port || 'N/A'}</div>
          <div class="service-detail"><strong>Addresses:</strong> <code>${formatAddresses(svc.addresses)}</code></div>
          <div class="service-detail"><strong>TXT:</strong> <code>${formatTxtRecords(svc.txt)}</code></div>
          <div class="service-detail"><strong>Full Name:</strong> <code>${svc.fullName}</code></div>
        </div>
      </div>
    `;
  }
}
