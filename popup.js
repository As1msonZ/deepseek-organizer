document.addEventListener('DOMContentLoaded', function() {
    loadAllSettings();
    setupEventListeners();
});

async function loadAllSettings() {
    try {
        const settings = await chrome.storage.local.get([
            'organizerVisible',
            'autoCollapseGroups',
            'showGroupCounts'
        ]);
        
        document.getElementById('toggle-organizer').checked = settings.organizerVisible !== false;
        document.getElementById('toggle-auto-collapse').checked = settings.autoCollapseGroups || false;
        document.getElementById('toggle-show-counts').checked = settings.showGroupCounts !== false;
        
        const tokenSettings = await chrome.storage.local.get(['tokenCounterSettings']);
        if (tokenSettings.tokenCounterSettings) {
            document.getElementById('toggle-token-counter').checked = tokenSettings.tokenCounterSettings.showWarnings !== false;
            document.getElementById('toggle-auto-calculate').checked = tokenSettings.tokenCounterSettings.autoCalculate !== false;
            document.getElementById('toggle-show-warnings').checked = tokenSettings.tokenCounterSettings.showWarnings !== false;
            document.getElementById('toggle-advanced-counting').checked = tokenSettings.tokenCounterSettings.useAdvancedCounting !== false;
            document.getElementById('warning-threshold').value = tokenSettings.tokenCounterSettings.warningThreshold || 80;
            document.getElementById('threshold-value').textContent = (tokenSettings.tokenCounterSettings.warningThreshold || 80) + '%';
        }
        
        await loadStats();
        showStatus('Настройки загружены', 'success');
    } catch (error) {
        console.error('Error loading settings:', error);
        showStatus('Ошибка загрузки', 'error');
    }
}

async function loadStats() {
    try {
        const result = await chrome.storage.local.get(['deepseekChatGroups']);
        const groups = result.deepseekChatGroups || [];
        
        const stats = countGroupsAndChats(groups);
        
        document.getElementById('groups-count').textContent = stats.totalGroups;
        document.getElementById('chats-count').textContent = stats.totalChats;
        
        const status = document.getElementById('status');
        if (groups.length === 0) {
            status.textContent = 'Группы не созданы';
        } else {
            status.textContent = `${stats.totalGroups} групп, ${stats.totalChats} чатов`;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function countGroupsAndChats(groups) {
    let totalGroups = 0;
    let totalChats = 0;
    
    const countRecursive = (groupList) => {
        groupList.forEach(group => {
            totalGroups++;
            totalChats += group.chats.length;
            if (group.subgroups && group.subgroups.length > 0) {
                countRecursive(group.subgroups);
            }
        });
    };
    
    countRecursive(groups);
    return { totalGroups, totalChats };
}

function setupEventListeners() {
    document.getElementById('toggle-organizer').addEventListener('change', toggleOrganizer);
    document.getElementById('toggle-auto-collapse').addEventListener('change', toggleAutoCollapse);
    document.getElementById('toggle-show-counts').addEventListener('change', toggleShowCounts);
    
    document.getElementById('collapse-all-btn').addEventListener('click', collapseAllGroups);
    document.getElementById('expand-all-btn').addEventListener('click', expandAllGroups);
    document.getElementById('create-group-btn').addEventListener('click', createGroup);
    document.getElementById('cleanup-groups-btn').addEventListener('click', cleanupEmptyGroups);
    
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', importData);
    document.getElementById('backup-btn').addEventListener('click', createBackup);
    document.getElementById('reset-btn').addEventListener('click', resetAllData);
    
    document.getElementById('toggle-token-counter').addEventListener('change', updateTokenCounterSettings);
    document.getElementById('toggle-auto-calculate').addEventListener('change', updateTokenCounterSettings);
    document.getElementById('toggle-show-warnings').addEventListener('change', updateTokenCounterSettings);
    document.getElementById('toggle-advanced-counting').addEventListener('change', updateTokenCounterSettings);
    document.getElementById('warning-threshold').addEventListener('input', updateThresholdValue);
    document.getElementById('warning-threshold').addEventListener('change', updateTokenCounterSettings);
    document.getElementById('reset-token-counter').addEventListener('click', resetTokenCounter);
    
    updateThresholdValue();
}

async function toggleOrganizer(event) {
    const isVisible = event.target.checked;
    
    try {
        await chrome.storage.local.set({ organizerVisible: isVisible });
        
        await sendMessageToContentScript({
            action: 'TOGGLE_ORGANIZER',
            visible: isVisible
        });
        
        showStatus(isVisible ? 'Организатор показан' : 'Организатор скрыт', 'success');
    } catch (error) {
        console.error('Error toggling organizer:', error);
        showStatus('Ошибка переключения', 'error');
    }
}

async function toggleAutoCollapse(event) {
    const autoCollapse = event.target.checked;
    
    try {
        await chrome.storage.local.set({ autoCollapseGroups: autoCollapse });
        
        await sendMessageToContentScript({
            action: 'TOGGLE_AUTO_COLLAPSE',
            autoCollapse: autoCollapse
        });
        
        showStatus(autoCollapse ? 'Авто-сворачивание включено' : 'Авто-сворачивание выключено', 'success');
    } catch (error) {
        console.error('Error toggling auto-collapse:', error);
        showStatus('Ошибка настройки', 'error');
    }
}

async function toggleShowCounts(event) {
    const showCounts = event.target.checked;
    
    try {
        await chrome.storage.local.set({ showGroupCounts: showCounts });
        
        await sendMessageToContentScript({
            action: 'TOGGLE_SHOW_COUNTS',
            showCounts: showCounts
        });
        
        showStatus(showCounts ? 'Показ количеств включен' : 'Показ количеств выключен', 'success');
    } catch (error) {
        console.error('Error toggling show counts:', error);
        showStatus('Ошибка настройки', 'error');
    }
}

async function collapseAllGroups() {
    try {
        await sendMessageToContentScript({
            action: 'COLLAPSE_ALL_GROUPS'
        });
        
        showStatus('Все группы свернуты', 'success');
    } catch (error) {
        console.error('Error collapsing groups:', error);
        showStatus('Ошибка сворачивания', 'error');
    }
}

async function expandAllGroups() {
    try {
        await sendMessageToContentScript({
            action: 'EXPAND_ALL_GROUPS'
        });
        
        showStatus('Все группы развернуты', 'success');
    } catch (error) {
        console.error('Error expanding groups:', error);
        showStatus('Ошибка разворачивания', 'error');
    }
}

async function createGroup() {
    const groupName = prompt('Введите название новой группы:');
    if (groupName && groupName.trim()) {
        try {
            await sendMessageToContentScript({
                action: 'CREATE_GROUP',
                name: groupName.trim()
            });
            
            showStatus('Группа создана', 'success');
            setTimeout(loadStats, 500);
        } catch (error) {
            console.error('Error creating group:', error);
            showStatus('Ошибка создания группы', 'error');
        }
    }
}

async function cleanupEmptyGroups() {
    if (!confirm('Удалить все пустые группы (без чатов)?')) {
        return;
    }
    
    try {
        await sendMessageToContentScript({
            action: 'CLEANUP_EMPTY_GROUPS'
        });
        
        showStatus('Пустые группы удалены', 'success');
        setTimeout(loadStats, 500);
    } catch (error) {
        console.error('Error cleaning up groups:', error);
        showStatus('Ошибка очистки', 'error');
    }
}

async function updateTokenCounterSettings() {
    const settings = {
        showWarnings: document.getElementById('toggle-show-warnings').checked,
        autoCalculate: document.getElementById('toggle-auto-calculate').checked,
        useAdvancedCounting: document.getElementById('toggle-advanced-counting').checked,
        warningThreshold: parseInt(document.getElementById('warning-threshold').value)
    };
    
    try {
        await chrome.storage.local.set({ tokenCounterSettings: settings });
        
        await sendMessageToContentScript({
            action: 'UPDATE_TOKEN_COUNTER_SETTINGS',
            settings: settings
        });
        
        const isCounterEnabled = document.getElementById('toggle-token-counter').checked;
        await sendMessageToContentScript({
            action: 'TOGGLE_TOKEN_COUNTER',
            visible: isCounterEnabled
        });
        
        showStatus('Настройки счетчика обновлены', 'success');
    } catch (error) {
        console.error('Error updating token counter settings:', error);
        showStatus('Ошибка обновления', 'error');
    }
}

async function resetTokenCounter() {
    try {
        await sendMessageToContentScript({
            action: 'RESET_TOKEN_COUNTER'
        });
        
        showStatus('Счетчик сброшен', 'success');
    } catch (error) {
        console.error('Error resetting token counter:', error);
        showStatus('Ошибка сброса', 'error');
    }
}

function updateThresholdValue() {
    const value = document.getElementById('warning-threshold').value;
    document.getElementById('threshold-value').textContent = value + '%';
}

async function exportData() {
    try {
        const result = await chrome.storage.local.get(['deepseekChatGroups']);
        const data = result.deepseekChatGroups || [];
        
        if (data.length === 0) {
            showStatus('Нет данных для экспорта', 'error');
            return;
        }

        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            groups: data
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const url = URL.createObjectURL(dataBlob);
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = `deepseek-chat-groups-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
        
        showStatus('Данные экспортированы', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showStatus('Ошибка экспорта', 'error');
    }
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const importData = JSON.parse(text);
            
            if (!importData.groups || !Array.isArray(importData.groups)) {
                throw new Error('Неверный формат файла');
            }

            await chrome.storage.local.set({ deepseekChatGroups: importData.groups });
            
            await sendMessageToContentScript({
                action: 'DATA_IMPORTED'
            });
            
            showStatus('Данные импортированы', 'success');
            
            setTimeout(loadStats, 500);
        } catch (err) {
            console.error('Import error:', err);
            showStatus('Ошибка импорта: неверный формат', 'error');
        }
    };
    
    input.click();
}

async function createBackup() {
    try {
        const result = await chrome.storage.local.get(['deepseekChatGroups']);
        const currentGroups = result.deepseekChatGroups || [];
        
        const backupData = {
            groups: currentGroups,
            backupDate: new Date().toISOString(),
            version: '1.0'
        };
        
        await chrome.storage.local.set({ 
            deepseekChatGroupsBackup: backupData
        });
        
        showStatus('Резервная копия создана', 'success');
    } catch (error) {
        console.error('Backup error:', error);
        showStatus('Ошибка создания резервной копии', 'error');
    }
}

async function resetAllData() {
    if (!confirm('Вы уверены, что хотите удалить ВСЕ группы и чаты? Это действие нельзя отменить.')) {
        return;
    }

    try {
        await chrome.storage.local.set({ deepseekChatGroups: [] });
        
        await sendMessageToContentScript({
            action: 'DATA_RESET'
        });
        
        showStatus('Все данные сброшены', 'success');
        
        setTimeout(loadStats, 500);
    } catch (error) {
        console.error('Reset error:', error);
        showStatus('Ошибка сброса данных', 'error');
    }
}

async function sendMessageToContentScript(message) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            await chrome.tabs.sendMessage(tab.id, message);
        }
    } catch (error) {
        console.error('Error sending message to content script:', error);
        throw error;
    }
}

function showStatus(message, type = 'info') {
    const status = document.getElementById('status');
    status.textContent = message;
    
    status.className = 'status';
    
    if (type === 'success') {
        status.style.background = '#ecfdf5';
        status.style.color = '#059669';
        status.style.border = '1px solid #a7f3d0';
    } else if (type === 'error') {
        status.style.background = '#fef2f2';
        status.style.color = '#dc2626';
        status.style.border = '1px solid #fecaca';
    } else if (type === 'warning') {
        status.style.background = '#fffbeb';
        status.style.color = '#d97706';
        status.style.border = '1px solid #fed7aa';
    }
    
    setTimeout(() => {
        status.style.background = '';
        status.style.color = '';
        status.style.border = '';
        loadStats();
    }, 3000);
}

setInterval(loadStats, 2000);