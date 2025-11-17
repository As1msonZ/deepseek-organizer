class LicenseService {
  constructor() {
    this.isActivated = false;
    this.init();
  }

  async init() {
    await this.checkActivation();
    this.setupUpdateChecker();
  }

  async checkActivation() {
    const result = await chrome.storage.local.get(['authToken', 'authValidUntil', 'isActivated']);
    const now = Date.now();
    
    if (result.authToken && result.authValidUntil && result.authValidUntil > now) {
      this.isActivated = true;
      console.log('Расширение активировано');
    } else {
      this.isActivated = false;
      await chrome.storage.local.remove(['authToken', 'authValidUntil', 'isActivated']);
      console.log('Требуется активация расширения');
    }
  }

  async showAuthPopup() {
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL('auth.html'),
        type: 'popup',
        width: 400,
        height: 500
      });
    } catch (error) {
      console.error('Ошибка открытия окна аутентификации:', error);
    }
  }

  setupUpdateChecker() {
    setInterval(() => {
      this.checkForUpdates();
    }, 12 * 60 * 60 * 1000);
    
    setTimeout(() => this.checkForUpdates(), 10000);
  }

  async checkForUpdates() {
    try {
      const manifest = chrome.runtime.getManifest();
      const currentVersion = manifest.version;
      
      const response = await fetch('https://raw.githubusercontent.com/YOUR_USERNAME/deepseek-organizer/main/manifest.json?t=' + Date.now());
      if (!response.ok) return;
      
      const remoteManifest = await response.json();
      
      if (this.compareVersions(remoteManifest.version, currentVersion) > 0) {
        this.showUpdateNotification(remoteManifest.version);
      }
    } catch (error) {
      console.error('Ошибка проверки обновлений:', error);
    }
  }

  compareVersions(versionA, versionB) {
    const partsA = versionA.split('.').map(Number);
    const partsB = versionB.split('.').map(Number);
    
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;
      
      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }
    
    return 0;
  }

  showUpdateNotification(newVersion) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Доступно обновление',
      message: `Версия ${newVersion} готова к установке. Нажмите для обновления.`
    });

    chrome.notifications.onClicked.addListener(() => {
      chrome.tabs.create({
        url: 'https://github.com/YOUR_USERNAME/deepseek-organizer'
      });
    });
  }
}

let licenseService = null;

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('DeepSeek Chat Organizer installed');
  licenseService = new LicenseService();
  
  if (details.reason === 'install') {
    setTimeout(() => {
      licenseService.showAuthPopup();
    }, 1000);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!licenseService) {
    licenseService = new LicenseService();
  }
  
  await licenseService.checkActivation();
  
  if (licenseService.isActivated) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggleOrganizer' });
  } else {
    licenseService.showAuthPopup();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveGroups') {
    chrome.storage.local.set({ deepseekChatGroups: request.groups });
  } else if (request.action === 'loadGroups') {
    chrome.storage.local.get(['deepseekChatGroups'], (result) => {
      sendResponse({ groups: result.deepseekChatGroups || [] });
    });
    return true;
  } else if (request.action === 'checkAuth') {
    if (licenseService) {
      licenseService.checkActivation().then(() => {
        sendResponse({ isActivated: licenseService.isActivated });
      });
      return true;
    }
  } else if (request.action === 'showAuth') {
    if (licenseService) {
      licenseService.showAuthPopup();
      sendResponse({ success: true });
    }
    return true;
  }
});

chrome.runtime.onUpdateAvailable.addListener((details) => {
  console.log('Update available:', details.version);
  chrome.runtime.reload();
});