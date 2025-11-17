class AuthManager {
    constructor() {
        this.isAuthenticated = false;
        this.checkInterval = null;
        this.init();
    }

    async init() {
        await this.checkAuthentication();
        this.setupAuthChecker();
    }

    async checkAuthentication() {
        try {
            const result = await chrome.storage.local.get(['authToken', 'authValidUntil', 'isActivated']);
            const now = Date.now();
            
            this.isAuthenticated = !!(result.authToken && result.authValidUntil && result.authValidUntil > now);
            
            if (!this.isAuthenticated) {
                this.showAuthRequired();
            } else {
                this.hideAuthRequired();
            }
            
            return this.isAuthenticated;
        } catch (error) {
            console.error('Auth check error:', error);
            this.showAuthRequired();
            return false;
        }
    }

    setupAuthChecker() {
        this.checkInterval = setInterval(() => {
            this.checkAuthentication();
        }, 5 * 60 * 1000);
    }

    showAuthRequired() {
        const existingMsg = document.getElementById('deepseek-auth-required');
        if (existingMsg) return;

        const authMsg = document.createElement('div');
        authMsg.id = 'deepseek-auth-required';
        authMsg.innerHTML = `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border: 2px solid #e5e7eb;
                border-radius: 12px;
                padding: 30px;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                z-index: 10000;
                max-width: 400px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <div style="font-size: 24px; margin-bottom: 16px;">🔒</div>
                <h3 style="margin: 0 0 12px 0; color: #374151; font-size: 18px;">
                    Требуется активация
                </h3>
                <p style="color: #6b7280; margin: 0 0 20px 0; line-height: 1.5;">
                    Для использования расширения необходим токен доступа.
                </p>
                <button id="activate-extension-btn" style="
                    background: #3b82f6;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background-color 0.2s;
                ">Активировать расширение</button>
            </div>
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9999;
            "></div>
        `;

        document.body.appendChild(authMsg);

        document.getElementById('activate-extension-btn').addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'showAuth' });
        });
    }

    hideAuthRequired() {
        const authMsg = document.getElementById('deepseek-auth-required');
        if (authMsg) {
            authMsg.remove();
        }
    }

    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        this.hideAuthRequired();
    }
}

class ChatOrganizer {
    constructor() {
        this.authManager = new AuthManager();
        this.groups = [];
        this.isInitialized = false;
        this.chatMap = new Map();
        this.hiddenChats = new Set();
        this.observer = null;
        this.navigationObserver = null;
        this.autoCollapse = false;
        this.showCounts = true;
        this.tokenCounter = null;
        
        this.init();
    }

    async init() {
        if (this.isInitialized) return;
        
        const isAuthenticated = await this.authManager.checkAuthentication();
        if (!isAuthenticated) {
            console.log('Organizer: расширение не активировано');
            return;
        }
        
        await this.loadGroups();
        await this.loadSettings();
        this.waitForSidebar();
        this.setupNavigationObserver();
        this.isInitialized = true;
    }

    async loadGroups() {
        try {
            const result = await chrome.storage.local.get(['deepseekChatGroups']);
            this.groups = result.deepseekChatGroups || [];
            
            const initializeCollapsed = (groups) => {
                groups.forEach(group => {
                    if (group.collapsed === undefined) {
                        group.collapsed = this.autoCollapse;
                    }
                    if (group.subgroups) {
                        initializeCollapsed(group.subgroups);
                    }
                });
            };
            initializeCollapsed(this.groups);
            
            setTimeout(() => this.hideGroupChats(), 500);
        } catch (error) {
            console.error('Error loading groups:', error);
            this.groups = [];
        }
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.local.get([
                'organizerVisible',
                'autoCollapseGroups',
                'showGroupCounts',
                'tokenCounterVisible'
            ]);
            
            this.autoCollapse = result.autoCollapseGroups || false;
            this.showCounts = result.showGroupCounts !== false;
            
            if (result.organizerVisible === false) {
                const root = document.getElementById('chat-organizer-root');
                if (root) {
                    root.style.display = 'none';
                }
            }

            if (this.autoCollapse) {
                this.collapseAllGroups();
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    async saveGroups() {
        try {
            await chrome.storage.local.set({ deepseekChatGroups: this.groups });
        } catch (error) {
            console.error('Error saving groups:', error);
        }
    }

    setupNavigationObserver() {
        this.navigationObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    const chatContentChanged = Array.from(mutation.addedNodes).some(node => 
                        node.nodeType === 1 && (
                            node.querySelector('[class*="chat-container"]') ||
                            node.querySelector('[class*="message"]') ||
                            node.querySelector('[class*="conversation"]')
                        )
                    );
                    
                    if (chatContentChanged) {
                        setTimeout(() => {
                            this.reinitializeAfterNavigation();
                        }, 300);
                    }
                }
            });
        });

        this.navigationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    reinitializeAfterNavigation() {
        this.updateChatMap();
        this.renderGroups();
        this.hideGroupChats();
        this.makeChatsDraggable();
        
        if (this.tokenCounter) {
            setTimeout(() => {
                this.tokenCounter.analyzeCurrentChat();
            }, 500);
        }
    }

    waitForSidebar() {
        const observer = new MutationObserver((mutations, obs) => {
            const sidebar = document.querySelector('.dc04ec1d');
            if (sidebar && !document.getElementById('chat-organizer-root')) {
                this.injectOrganizer();
                this.startObservingChats();
                this.initializeTokenCounter();
                obs.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            if (!document.getElementById('chat-organizer-root')) {
                this.injectOrganizer();
                this.startObservingChats();
                this.initializeTokenCounter();
            }
        }, 1000);
    }

    initializeTokenCounter() {
        if (!this.tokenCounter) {
            this.tokenCounter = new DeepSeekTokenCounter();
            this.tokenCounter.injectCounter();
        }
    }

    injectOrganizer() {
        const sidebar = document.querySelector('.dc04ec1d');
        if (!sidebar) return;

        const organizerHTML = `
            <div id="chat-organizer-root" class="chat-organizer-root chat-organizer-persistent">
                <div class="chat-organizer-header">
                    <h3 class="chat-organizer-title">🗂️ Группы чатов</h3>
                    <div class="chat-organizer-actions">
                        <button id="chat-organizer-add-group" class="chat-organizer-btn" title="Добавить группу">
                            <span>+</span>
                        </button>
                        <button id="chat-organizer-toggle" class="chat-organizer-btn" title="Свернуть/развернуть">
                            <span>−</span>
                        </button>
                    </div>
                </div>
                <div id="chat-organizer-groups" class="chat-organizer-groups"></div>
                <div id="chat-organizer-drop-zone" class="chat-organizer-drop-zone">
                    Перетащите чат сюда для создания новой группы
                </div>
                
                <div id="token-counter-container" class="token-counter-container"></div>
            </div>
        `;

        const newChatSection = sidebar.querySelector('._5a8ac7a');
        if (newChatSection) {
            newChatSection.parentNode.insertBefore(this.htmlToElement(organizerHTML), newChatSection.nextSibling);
        } else {
            sidebar.insertBefore(this.htmlToElement(organizerHTML), sidebar.firstChild);
        }

        this.setupEventListeners();
        this.renderGroups();
    }

    htmlToElement(html) {
        const template = document.createElement('template');
        template.innerHTML = html.trim();
        return template.content.firstChild;
    }

    setupEventListeners() {
        document.getElementById('chat-organizer-add-group').addEventListener('click', () => {
            this.showAddGroupModal();
        });

        document.getElementById('chat-organizer-toggle').addEventListener('click', () => {
            this.toggleGroups();
        });

        const dropZone = document.getElementById('chat-organizer-drop-zone');
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            this.handleDropToNewGroup(e);
        });
    }

    toggleGroups() {
        const groupsContainer = document.getElementById('chat-organizer-groups');
        const toggleBtn = document.getElementById('chat-organizer-toggle');
        
        groupsContainer.classList.toggle('collapsed');
        toggleBtn.querySelector('span').textContent = 
            groupsContainer.classList.contains('collapsed') ? '+' : '−';
    }

    showAddGroupModal() {
        const groupName = prompt('Введите название группы:');
        if (groupName && groupName.trim()) {
            this.addGroup(groupName.trim());
        }
    }

    startObservingChats() {
        this.observer = new MutationObserver(() => {
            this.makeChatsDraggable();
            this.updateChatMap();
            setTimeout(() => this.hideGroupChats(), 100);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            this.makeChatsDraggable();
            this.updateChatMap();
            this.hideGroupChats();
        }, 500);
    }

    updateChatMap() {
        const chatItems = document.querySelectorAll('a[href*="/a/chat/s/"]');
        
        chatItems.forEach(chatItem => {
            const chatTitle = chatItem.querySelector('.c08e6e93')?.textContent || 
                            chatItem.textContent || 'Без названия';
            const chatUrl = chatItem.href;
            const chatId = this.extractChatId(chatUrl);
            
            this.chatMap.set(chatId, {
                title: chatTitle,
                url: chatUrl,
                element: chatItem
            });
        });
    }

    extractChatId(url) {
        const match = url.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
        return match ? match[1] : url;
    }

    makeChatsDraggable() {
        const chatItems = document.querySelectorAll('a[href*="/a/chat/s/"]:not(.chat-organizer-hidden)');
        
        chatItems.forEach(chatItem => {
            if (chatItem.hasAttribute('data-draggable')) return;

            chatItem.setAttribute('data-draggable', 'true');
            chatItem.draggable = true;
            
            const dragHandle = document.createElement('div');
            dragHandle.className = 'chat-drag-handle';
            dragHandle.innerHTML = '⋮⋮';
            chatItem.style.position = 'relative';
            if (!chatItem.querySelector('.chat-drag-handle')) {
                chatItem.appendChild(dragHandle);
            }

            chatItem.addEventListener('dragstart', (e) => {
                const chatTitle = chatItem.querySelector('.c08e6e93')?.textContent || 
                                chatItem.textContent || 'Без названия';
                const chatUrl = chatItem.href;
                const chatId = this.extractChatId(chatUrl);
                
                e.dataTransfer.setData('text/plain', chatTitle);
                e.dataTransfer.setData('chat-url', chatUrl);
                e.dataTransfer.setData('chat-id', chatId);
                chatItem.classList.add('dragging');
            });

            chatItem.addEventListener('dragend', () => {
                chatItem.classList.remove('dragging');
            });
        });
    }

    hideGroupChats() {
        this.hiddenChats.forEach(chatId => {
            const chatInfo = this.chatMap.get(chatId);
            if (chatInfo && chatInfo.element) {
                chatInfo.element.classList.remove('chat-organizer-hidden');
            }
        });
        this.hiddenChats.clear();

        const hideChatsInGroup = (groups) => {
            groups.forEach(group => {
                group.chats.forEach(chat => {
                    const chatId = typeof chat === 'string' ? this.extractChatId(chat) : chat.id;
                    const chatInfo = this.chatMap.get(chatId);
                    if (chatInfo && chatInfo.element) {
                        chatInfo.element.classList.add('chat-organizer-hidden');
                        this.hiddenChats.add(chatId);
                    }
                });
                if (group.subgroups) {
                    hideChatsInGroup(group.subgroups);
                }
            });
        };

        hideChatsInGroup(this.groups);
    }

    addGroup(name, parentGroupId = null) {
        const group = {
            id: 'group_' + Date.now(),
            name: name,
            chats: [],
            subgroups: [],
            parentId: parentGroupId,
            collapsed: false
        };

        if (parentGroupId) {
            const parentGroup = this.findGroup(this.groups, parentGroupId);
            if (parentGroup) {
                if (!parentGroup.subgroups) {
                    parentGroup.subgroups = [];
                }
                parentGroup.subgroups.push(group);
                parentGroup.collapsed = false;
            }
        } else {
            this.groups.push(group);
        }

        this.saveGroups();
        this.renderGroups();
    }

    findGroup(groups, groupId) {
        for (const group of groups) {
            if (group.id === groupId) return group;
            if (group.subgroups && group.subgroups.length) {
                const found = this.findGroup(group.subgroups, groupId);
                if (found) return found;
            }
        }
        return null;
    }

    renderGroups() {
        const groupsContainer = document.getElementById('chat-organizer-groups');
        if (!groupsContainer) return;

        groupsContainer.innerHTML = '';
        
        if (this.groups.length === 0) {
            groupsContainer.innerHTML = `
                <div class="empty-state">
                    Нет групп. Создайте первую группу или перетащите сюда чат.
                </div>
            `;
            return;
        }

        this.renderGroupList(this.groups, groupsContainer);
        this.hideGroupChats();
    }

    renderGroupList(groups, container, level = 0) {
        groups.forEach(group => {
            const groupElement = this.createGroupElement(group, level);
            container.appendChild(groupElement);
        });
    }

    createGroupElement(group, level = 0) {
        const groupElement = document.createElement('div');
        groupElement.className = `chat-group ${group.collapsed ? 'collapsed' : ''}`;
        groupElement.setAttribute('data-group-id', group.id);
        groupElement.setAttribute('data-level', level);

        const chatsHTML = group.chats.map(chat => {
            const chatInfo = typeof chat === 'string' ? 
                { title: chat, url: '', id: this.extractChatId(chat) } : 
                chat;
            
            const chatUrl = chatInfo.url || this.findChatUrlById(chatInfo.id);
            
            if (chatUrl) {
                return `
                    <a href="${chatUrl}" class="group-chat-item link-chat-item" data-chat-id="${chatInfo.id}">
                        <span class="chat-title">${chatInfo.title}</span>
                        <button class="remove-chat-btn" title="Вернуть в общий список">↶</button>
                    </a>
                `;
            } else {
                return `
                    <div class="group-chat-item" data-chat-id="${chatInfo.id}">
                        <span class="chat-title">${chatInfo.title}</span>
                        <button class="remove-chat-btn" title="Вернуть в общий список">↶</button>
                    </div>
                `;
            }
        }).join('');

        const totalChats = group.chats.length + this.getTotalChatsInSubgroups(group);
        const countHtml = this.showCounts ? 
            `<span class="group-count">(${totalChats})</span>` : '';

        const hasSubgroups = group.subgroups && group.subgroups.length > 0;
        const hasContent = group.chats.length > 0 || hasSubgroups;

        groupElement.innerHTML = `
            <div class="group-header">
                <div class="group-info">
                    <button class="group-toggle ${hasContent ? '' : 'hidden'}" 
                            style="visibility: ${hasContent ? 'visible' : 'hidden'}">
                        ${group.collapsed ? '▶' : '▼'}
                    </button>
                    <span class="group-name">${group.name}</span>
                    ${countHtml}
                </div>
                <div class="group-actions">
                    <button class="add-subgroup-btn" title="Добавить подгруппу">+</button>
                    <button class="delete-group-btn" title="Удалить группу">×</button>
                </div>
            </div>
            <div class="group-content ${group.collapsed ? 'collapsed' : ''}">
                <div class="group-chats">
                    ${chatsHTML}
                    ${group.chats.length === 0 && (!hasSubgroups || group.collapsed) ? `
                        <div class="empty-group-message">Перетащите сюда чаты</div>
                    ` : ''}
                </div>
                ${hasSubgroups ? `
                    <div class="subgroups-container">
                        ${this.renderSubgroupsHTML(group.subgroups, level + 1)}
                    </div>
                ` : ''}
            </div>
        `;

        this.setupGroupEventListeners(groupElement, group);
        this.makeGroupDropTarget(groupElement, group.id);
        
        return groupElement;
    }

    getTotalChatsInSubgroups(group) {
        let total = 0;
        
        const countSubgroupChats = (subgroups) => {
            subgroups.forEach(subgroup => {
                total += subgroup.chats.length;
                if (subgroup.subgroups && subgroup.subgroups.length > 0) {
                    countSubgroupChats(subgroup.subgroups);
                }
            });
        };
        
        if (group.subgroups && group.subgroups.length > 0) {
            countSubgroupChats(group.subgroups);
        }
        
        return total;
    }

    renderSubgroupsHTML(subgroups, level) {
        return subgroups.map(subgroup => {
            const subgroupElement = this.createGroupElement(subgroup, level);
            return subgroupElement.outerHTML;
        }).join('');
    }

    findChatUrlById(chatId) {
        const chatInfo = this.chatMap.get(chatId);
        return chatInfo ? chatInfo.url : '';
    }

    setupGroupEventListeners(groupElement, group) {
        const toggleBtn = groupElement.querySelector('.group-toggle');
        const addSubgroupBtn = groupElement.querySelector('.add-subgroup-btn');
        const deleteBtn = groupElement.querySelector('.delete-group-btn');
        const removeChatBtns = groupElement.querySelectorAll('.remove-chat-btn');
        const groupContent = groupElement.querySelector('.group-content');

        const groupHeader = groupElement.querySelector('.group-header');
        groupHeader.addEventListener('click', (e) => {
            if (!e.target.closest('.group-actions') && !e.target.closest('.group-toggle')) {
                this.toggleGroup(group, groupElement, toggleBtn, groupContent);
            }
        });

        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleGroup(group, groupElement, toggleBtn, groupContent);
            });
        }

        addSubgroupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const subgroupName = prompt('Введите название подгруппы:');
            if (subgroupName && subgroupName.trim()) {
                this.addGroup(subgroupName.trim(), group.id);
            }
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Удалить группу "${group.name}" и все подгруппы? Все чаты вернутся в общий список.`)) {
                this.returnAllChatsToMainList(group);
                this.removeGroup(group.id);
            }
        });

        removeChatBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const chatItem = e.target.closest('.group-chat-item');
                const chatId = chatItem.getAttribute('data-chat-id');
                this.returnChatToMainList(chatId, group.id);
            });
        });

        const chatLinks = groupElement.querySelectorAll('.link-chat-item');
        chatLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                // Allow normal link behavior
            });
        });
    }

    toggleGroup(group, groupElement, toggleBtn, groupContent) {
        group.collapsed = !group.collapsed;
        
        groupElement.classList.toggle('collapsed', group.collapsed);
        if (groupContent) {
            groupContent.classList.toggle('collapsed', group.collapsed);
        }
        
        if (toggleBtn) {
            toggleBtn.textContent = group.collapsed ? '▶' : '▼';
        }
        
        this.saveGroups();
        
        if (group.subgroups && group.subgroups.length > 0) {
            setTimeout(() => this.renderGroups(), 10);
        }
    }

    makeGroupDropTarget(groupElement, groupId) {
        groupElement.addEventListener('dragover', (e) => {
            e.preventDefault();
            groupElement.classList.add('drag-over');
        });

        groupElement.addEventListener('dragleave', () => {
            groupElement.classList.remove('drag-over');
        });

        groupElement.addEventListener('drop', (e) => {
            e.preventDefault();
            groupElement.classList.remove('drag-over');
            this.handleDrop(e, groupId);
        });
    }

    handleDrop(e, groupId) {
        const chatTitle = e.dataTransfer.getData('text/plain');
        const chatUrl = e.dataTransfer.getData('chat-url');
        const chatId = e.dataTransfer.getData('chat-id');
        
        if (chatId) {
            this.moveChatToGroup(chatId, chatTitle, chatUrl, groupId);
        }
    }

    handleDropToNewGroup(e) {
        const chatTitle = e.dataTransfer.getData('text/plain');
        const chatUrl = e.dataTransfer.getData('chat-url');
        const chatId = e.dataTransfer.getData('chat-id');
        
        if (chatId) {
            const groupName = prompt('Введите название для новой группы:');
            if (groupName && groupName.trim()) {
                this.addGroup(groupName.trim());
                setTimeout(() => {
                    const newGroup = this.groups[this.groups.length - 1];
                    if (newGroup) {
                        this.moveChatToGroup(chatId, chatTitle, chatUrl, newGroup.id);
                    }
                }, 100);
            }
        }
    }

    async moveChatToGroup(chatId, chatTitle, chatUrl, groupId) {
        const group = this.findGroup(this.groups, groupId);
        if (group) {
            const chatExists = group.chats.some(chat => {
                const existingChatId = typeof chat === 'string' ? this.extractChatId(chat) : chat.id;
                return existingChatId === chatId;
            });

            if (!chatExists) {
                this.removeChatFromAllGroups(chatId);
                
                group.chats.push({ 
                    id: chatId, 
                    title: chatTitle, 
                    url: chatUrl 
                });
                
                await this.saveGroups();
                this.renderGroups();
                this.hideGroupChats();
                this.makeChatsDraggable();
            }
        }
    }

    removeChatFromAllGroups(chatId) {
        const removeFromGroups = (groups) => {
            groups.forEach(group => {
                group.chats = group.chats.filter(chat => {
                    const existingChatId = typeof chat === 'string' ? this.extractChatId(chat) : chat.id;
                    return existingChatId !== chatId;
                });
                if (group.subgroups) {
                    removeFromGroups(group.subgroups);
                }
            });
        };
        
        removeFromGroups(this.groups);
    }

    async returnChatToMainList(chatId, groupId) {
        const group = this.findGroup(this.groups, groupId);
        if (group) {
            group.chats = group.chats.filter(chat => {
                const existingChatId = typeof chat === 'string' ? this.extractChatId(chat) : chat.id;
                return existingChatId !== chatId;
            });
            
            await this.saveGroups();
            this.renderGroups();
            this.hideGroupChats();
            this.makeChatsDraggable();
        }
    }

    returnAllChatsToMainList(group) {
        const returnChats = (grp) => {
            grp.chats = [];
            if (grp.subgroups) {
                grp.subgroups.forEach(returnChats);
            }
        };
        
        returnChats(group);
    }

    removeGroup(groupId) {
        this.groups = this.removeGroupFromArray(this.groups, groupId);
        this.saveGroups();
        this.renderGroups();
        this.hideGroupChats();
        this.makeChatsDraggable();
    }

    removeGroupFromArray(groups, groupId) {
        return groups.filter(group => {
            if (group.id === groupId) return false;
            if (group.subgroups) {
                group.subgroups = this.removeGroupFromArray(group.subgroups, groupId);
            }
            return true;
        });
    }

    handleMessages(request) {
        switch (request.action) {
            case 'TOGGLE_ORGANIZER':
                this.toggleOrganizer(request.visible);
                break;
            case 'TOGGLE_AUTO_COLLAPSE':
                this.toggleAutoCollapse(request.autoCollapse);
                break;
            case 'TOGGLE_SHOW_COUNTS':
                this.toggleShowCounts(request.showCounts);
                break;
            case 'COLLAPSE_ALL_GROUPS':
                this.collapseAllGroups();
                break;
            case 'EXPAND_ALL_GROUPS':
                this.expandAllGroups();
                break;
            case 'CREATE_GROUP':
                this.addGroup(request.name);
                break;
            case 'CLEANUP_EMPTY_GROUPS':
                this.cleanupEmptyGroups();
                break;
            case 'DATA_IMPORTED':
            case 'DATA_RESET':
                this.loadGroups().then(() => {
                    this.renderGroups();
                    this.hideGroupChats();
                });
                break;
            case 'TOGGLE_GROUP':
                this.toggleGroupById(request.groupId, request.collapsed);
                break;
            case 'CREATE_SUBGROUP':
                this.addGroup(request.name, request.parentGroupId);
                break;
            case 'TOGGLE_TOKEN_COUNTER':
                if (this.tokenCounter) {
                    this.tokenCounter.toggleVisibility(request.visible);
                }
                break;
            case 'UPDATE_TOKEN_COUNTER_SETTINGS':
                if (this.tokenCounter) {
                    this.tokenCounter.updateSettings(request.settings);
                }
                break;
            case 'RESET_TOKEN_COUNTER':
                if (this.tokenCounter) {
                    this.tokenCounter.resetCounter();
                }
                break;
        }
    }

    toggleGroupById(groupId, collapsed) {
        const group = this.findGroup(this.groups, groupId);
        if (group) {
            group.collapsed = collapsed;
            this.saveGroups();
            this.renderGroups();
        }
    }

    toggleOrganizer(visible) {
        const root = document.getElementById('chat-organizer-root');
        if (root) {
            root.style.display = visible ? 'block' : 'none';
            chrome.storage.local.set({ organizerVisible: visible });
        }
    }

    toggleAutoCollapse(autoCollapse) {
        this.autoCollapse = autoCollapse;
        chrome.storage.local.set({ autoCollapseGroups: autoCollapse });
        
        if (autoCollapse) {
            this.collapseAllGroups();
        } else {
            this.expandAllGroups();
        }
    }

    toggleShowCounts(showCounts) {
        this.showCounts = showCounts;
        chrome.storage.local.set({ showGroupCounts: showCounts });
        this.renderGroups();
    }

    collapseAllGroups() {
        const collapseGroup = (groups) => {
            groups.forEach(group => {
                group.collapsed = true;
                if (group.subgroups) {
                    collapseGroup(group.subgroups);
                }
            });
        };
        
        collapseGroup(this.groups);
        this.saveGroups();
        this.renderGroups();
    }

    expandAllGroups() {
        const expandGroup = (groups) => {
            groups.forEach(group => {
                group.collapsed = false;
                if (group.subgroups) {
                    expandGroup(group.subgroups);
                }
            });
        };
        
        expandGroup(this.groups);
        this.saveGroups();
        this.renderGroups();
    }

    cleanupEmptyGroups() {
        const cleanup = (groups) => {
            return groups.filter(group => {
                if (group.chats.length > 0) return true;
                if (group.subgroups && group.subgroups.length > 0) {
                    group.subgroups = cleanup(group.subgroups);
                    return group.subgroups.length > 0;
                }
                return false;
            });
        };
        
        this.groups = cleanup(this.groups);
        this.saveGroups();
        this.renderGroups();
    }

    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        if (this.navigationObserver) {
            this.navigationObserver.disconnect();
        }
        if (this.tokenCounter) {
            this.tokenCounter.destroy();
        }
    }
}

class DeepSeekTokenCounter {
    constructor() {
        this.contextLimit = 128000;
        this.responseLimit = 4096;
        this.fileSizeLimit = 50;
        
        this.currentChatId = null;
        this.currentTokens = 0;
        this.estimatedWords = 0;
        this.usagePercentage = 0;
        this.conversationHistory = [];
        this.isInitialized = false;
        this.counterElement = null;
        this.conversationContainer = null;
        this.inputArea = null;
        this.observer = null;
        this.chatObserver = null;
        
        this.tokenSettings = {
            charsPerToken: 3.2,
            wordPerToken: 0.72,
            cyrillicMultiplier: 1.12,
            latinMultiplier: 0.92,
            chineseMultiplier: 2.0,
            specialTokenWeight: 1.1,
            codeMultiplier: 1.3,
            punctuationMultiplier: 0.7,
            numberMultiplier: 0.8,
            urlMultiplier: 0.9
        };
        
        this.settings = {
            showWarnings: true,
            autoCalculate: true,
            warningThreshold: 80,
            showTips: true,
            isCollapsed: false,
            useAdvancedCounting: true
        };
        
        this.init();
    }

    async init() {
        if (this.isInitialized) return;
        
        await this.loadSettings();
        this.waitForChatInterface();
        this.setupChatObserver();
        this.isInitialized = true;
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.local.get(['tokenCounterSettings']);
            if (result.tokenCounterSettings) {
                this.settings = { ...this.settings, ...result.tokenCounterSettings };
            }
        } catch (error) {
            console.error('Error loading token counter settings:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.local.set({ tokenCounterSettings: this.settings });
        } catch (error) {
            console.error('Error saving token counter settings:', error);
        }
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.saveSettings();
        this.updateCounterDisplay();
    }

    setupChatObserver() {
        this.chatObserver = new MutationObserver(() => {
            const currentUrl = window.location.href;
            const chatId = this.extractChatId(currentUrl);
            
            if (chatId && chatId !== this.currentChatId) {
                this.currentChatId = chatId;
                setTimeout(() => {
                    this.analyzeCurrentChat();
                }, 500);
            }
        });

        this.chatObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        const originalPushState = history.pushState;
        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            setTimeout(() => {
                const chatId = this.extractChatId(window.location.href);
                if (chatId && chatId !== this.currentChatId) {
                    this.currentChatId = chatId;
                    this.analyzeCurrentChat();
                }
            }, 100);
        };
    }

    extractChatId(url) {
        const match = url.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
        return match ? match[1] : null;
    }

    waitForChatInterface() {
        const observer = new MutationObserver(() => {
            const chatContainer = this.findChatContainer();
            const inputArea = this.findInputArea();
            
            if (chatContainer && inputArea && !this.conversationContainer) {
                this.conversationContainer = chatContainer;
                this.inputArea = inputArea;
                this.setupObservers();
                this.analyzeCurrentChat();
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            const chatContainer = this.findChatContainer();
            const inputArea = this.findInputArea();
            if (chatContainer && inputArea) {
                this.conversationContainer = chatContainer;
                this.inputArea = inputArea;
                this.setupObservers();
                this.analyzeCurrentChat();
            }
        }, 1000);
    }

    findChatContainer() {
        const selectors = [
            '[data-testid*="conversation"]',
            '[class*="conversation"]',
            '[class*="chat-container"]',
            '[class*="message-list"]',
            'main',
            '.flex-1',
            '[role="main"]'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const messages = element.querySelectorAll('[class*="message"], [class*="Message"], .prose');
                if (messages.length > 0) {
                    return element;
                }
            }
        }
        return document.body;
    }

    findInputArea() {
        const selectors = [
            'textarea[placeholder*="消息"]',
            'textarea[placeholder*="Message"]',
            'textarea[placeholder*="message"]',
            'textarea',
            '[contenteditable="true"]',
            '[role="textbox"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                return element;
            }
        }
        return null;
    }

    setupObservers() {
        if (!this.conversationContainer) return;

        this.observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && this.isMessageNode(node)) {
                            shouldUpdate = true;
                            break;
                        }
                    }
                }
            }

            if (shouldUpdate && this.settings.autoCalculate) {
                setTimeout(() => this.analyzeCurrentChat(), 100);
            }
        });

        this.observer.observe(this.conversationContainer, {
            childList: true,
            subtree: true
        });

        if (this.inputArea) {
            this.inputArea.addEventListener('input', () => {
                this.updateInputCounter();
            });
            
            this.inputArea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    setTimeout(() => this.analyzeCurrentChat(), 500);
                }
            });
        }

        this.setupFileUploadObserver();
    }

    setupFileUploadObserver() {
        const fileUploadSelectors = [
            'input[type="file"]',
            '[class*="upload"]',
            '[class*="file"]'
        ];

        fileUploadSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.addEventListener('change', (e) => {
                    this.handleFileUpload(e);
                });
            });
        });
    }

    handleFileUpload(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            const fileSizeMB = file.size / (1024 * 1024);
            
            if (fileSizeMB > this.fileSizeLimit) {
                this.showNotification(
                    `Файл "${file.name}" превышает лимит ${this.fileSizeLimit} МБ`,
                    'error'
                );
                event.target.value = '';
            } else {
                this.showNotification(
                    `Файл "${file.name}" загружен (${fileSizeMB.toFixed(1)} МБ)`,
                    'success'
                );
            }
        }
    }

    isMessageNode(node) {
        if (!node.classList) return false;
        
        const classList = Array.from(node.classList);
        return classList.some(className => 
            className.includes('message') || 
            className.includes('Message') ||
            className.includes('prose') ||
            className.includes('markdown')
        );
    }

    analyzeCurrentChat() {
        if (!this.conversationContainer) return;

        const messages = this.conversationContainer.querySelectorAll(
            '[class*="message"], [class*="Message"], .prose, [class*="markdown"]'
        );

        let totalText = '';
        this.conversationHistory = [];

        messages.forEach(message => {
            const text = this.extractTextContent(message);
            if (text && text.trim().length > 0) {
                totalText += text + ' ';
                this.conversationHistory.push({
                    text: text,
                    element: message
                });
            }
        });

        this.calculateTokens(totalText);
        this.updateCounterDisplay();
        this.checkLimits();
    }

    extractTextContent(element) {
        const clone = element.cloneNode(true);
        
        const removeSelectors = [
            'button',
            'svg',
            'img',
            '.hidden',
            '[aria-hidden="true"]'
        ];
        
        removeSelectors.forEach(selector => {
            clone.querySelectorAll(selector).forEach(el => el.remove());
        });

        return clone.textContent || clone.innerText || '';
    }

    calculateTokens(text) {
        if (!text || text.trim().length === 0) {
            this.currentTokens = 0;
            this.estimatedWords = 0;
            this.usagePercentage = 0;
            return;
        }

        const charCount = text.length;
        const wordCount = text.trim().split(/\s+/).length;
        
        let tokenCount = charCount / this.tokenSettings.charsPerToken;
        
        if (this.settings.useAdvancedCounting) {
            const cyrillicChars = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
            const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
            const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
            const otherChars = charCount - cyrillicChars - latinChars - chineseChars;
            
            tokenCount = (
                cyrillicChars * this.tokenSettings.cyrillicMultiplier +
                latinChars * this.tokenSettings.latinMultiplier +
                chineseChars * this.tokenSettings.chineseMultiplier +
                otherChars
            ) / this.tokenSettings.charsPerToken;
            
            const punctuation = (text.match(/[.,!?;:]/g) || []).length;
            tokenCount += punctuation * this.tokenSettings.punctuationMultiplier;
            
            const specialChars = (text.match(/[{}[\]()<>#*\\|`~]/g) || []).length;
            tokenCount += specialChars * this.tokenSettings.specialTokenWeight;
            
            const numbers = (text.match(/\b\d+\b/g) || []).length;
            tokenCount += numbers * this.tokenSettings.numberMultiplier;
            
            const urls = (text.match(/https?:\/\/[^\s]+/g) || []).length;
            tokenCount += urls * this.tokenSettings.urlMultiplier * 5;
            
            const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
            const inlineCode = (text.match(/`[^`]*`/g) || []).length;
            tokenCount += (codeBlocks * 10 + inlineCode * 2) * this.tokenSettings.codeMultiplier;
        }
        
        this.currentTokens = Math.max(1, Math.round(tokenCount));
        this.estimatedWords = wordCount;
        this.usagePercentage = Math.min(100, (this.currentTokens / this.contextLimit) * 100);
        
        console.log(`Token calculation: ${this.currentTokens} tokens, ${wordCount} words, ${charCount} chars, ${this.usagePercentage.toFixed(1)}% usage`);
    }

    estimateInputTokens() {
        if (!this.inputArea) return 0;
        
        const text = this.inputArea.value || this.inputArea.textContent || '';
        return this.calculateTokensForText(text);
    }

    calculateTokensForText(text) {
        if (!text || text.trim().length === 0) return 0;
        
        const charCount = text.length;
        let tokenCount = charCount / this.tokenSettings.charsPerToken;
        
        if (this.settings.useAdvancedCounting) {
            const cyrillicChars = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
            const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
            const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
            const otherChars = charCount - cyrillicChars - latinChars - chineseChars;
            
            tokenCount = (
                cyrillicChars * this.tokenSettings.cyrillicMultiplier +
                latinChars * this.tokenSettings.latinMultiplier +
                chineseChars * this.tokenSettings.chineseMultiplier +
                otherChars
            ) / this.tokenSettings.charsPerToken;
        }
        
        return Math.max(1, Math.round(tokenCount));
    }

    updateInputCounter() {
        if (!this.inputArea || !this.counterElement) return;
        
        const inputTokens = this.estimateInputTokens();
        const inputElement = this.counterElement.querySelector('.input-counter');
        
        if (inputElement) {
            inputElement.textContent = `${inputTokens} тк`;
            
            if (inputTokens > this.responseLimit) {
                inputElement.style.color = '#dc2626';
                inputElement.style.fontWeight = '600';
            } else if (inputTokens > this.responseLimit * 0.8) {
                inputElement.style.color = '#f59e0b';
                inputElement.style.fontWeight = '500';
            } else {
                inputElement.style.color = '#6b7280';
                inputElement.style.fontWeight = '400';
            }
        }
    }

    injectCounter() {
        if (this.counterElement) return;

        const container = document.getElementById('token-counter-container');
        if (!container) return;

        this.counterElement = document.createElement('div');
        this.counterElement.className = `deepseek-token-counter integrated ${this.settings.isCollapsed ? 'collapsed' : ''}`;
        this.counterElement.innerHTML = this.getCounterHTML();
        
        this.setupCounterEventListeners();
        container.appendChild(this.counterElement);
        
        this.updateCounterDisplay();
    }

    getCounterHTML() {
        return `
            <div class="token-counter-header">
                <div class="token-counter-title">📊 Счетчик токенов</div>
                <div class="token-counter-actions">
                    <button class="token-counter-btn settings-btn" title="Настройки">⚙</button>
                    <button class="token-counter-btn toggle-btn" title="Свернуть">${this.settings.isCollapsed ? '+' : '−'}</button>
                </div>
            </div>
            
            <div class="token-counter-content ${this.settings.isCollapsed ? 'hidden' : ''}">
                <div class="token-counter-main">
                    <div class="progress-container">
                        <div class="progress-labels">
                            <span class="progress-value">
                                <span class="current-tokens">0</span>/<span class="total-tokens">128K</span>
                            </span>
                            <span class="progress-percentage">0%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: 0%"></div>
                        </div>
                    </div>
                    
                    <div class="stats-info">
                        <div class="stat-item">
                            <span class="stat-label">Символы:</span>
                            <span class="stat-value">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Слова:</span>
                            <span class="stat-value">0</span>
                        </div>
                    </div>
                    
                    <div class="limits-info">
                        <div class="limit-item">
                            <span class="limit-label">Контекст:</span>
                            <span class="limit-value">128K</span>
                        </div>
                        <div class="limit-item">
                            <span class="limit-label">Ответ:</span>
                            <span class="limit-value">4K</span>
                        </div>
                        <div class="limit-item">
                            <span class="limit-label">Файлы:</span>
                            <span class="limit-value">50 МБ</span>
                        </div>
                    </div>
                    
                    <div class="input-counter-container">
                        <span class="input-counter-label">Текущее сообщение:</span>
                        <span class="input-counter">0 тк</span>
                    </div>
                </div>
                
                <div class="token-counter-settings hidden">
                    <div class="settings-title">Настройки счетчика</div>
                    
                    <div class="setting-group">
                        <label class="setting-label">
                            <input type="checkbox" class="setting-checkbox" data-setting="showWarnings" ${this.settings.showWarnings ? 'checked' : ''}>
                            Показывать предупреждения
                        </label>
                    </div>
                    
                    <div class="setting-group">
                        <label class="setting-label">
                            <input type="checkbox" class="setting-checkbox" data-setting="autoCalculate" ${this.settings.autoCalculate ? 'checked' : ''}>
                            Автоматический расчет
                        </label>
                    </div>
                    
                    <div class="setting-group">
                        <label class="setting-label">
                            <input type="checkbox" class="setting-checkbox" data-setting="useAdvancedCounting" ${this.settings.useAdvancedCounting ? 'checked' : ''}>
                            Продвинутый подсчет
                        </label>
                    </div>
                    
                    <div class="setting-group">
                        <label class="setting-label">Порог предупреждения:</label>
                        <input type="range" class="setting-range" data-setting="warningThreshold" 
                               min="50" max="95" value="${this.settings.warningThreshold}" step="5">
                        <span class="range-value">${this.settings.warningThreshold}%</span>
                    </div>
                </div>
            </div>
            
            <div class="token-counter-warnings"></div>
        `;
    }

    setupCounterEventListeners() {
        this.counterElement.querySelector('.toggle-btn').addEventListener('click', () => {
            this.toggleCounter();
        });

        this.counterElement.querySelector('.settings-btn').addEventListener('click', () => {
            this.toggleSettings();
        });

        const checkboxes = this.counterElement.querySelectorAll('.setting-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                this.settings[e.target.dataset.setting] = e.target.checked;
                this.saveSettings();
                
                if (e.target.dataset.setting === 'useAdvancedCounting') {
                    this.analyzeCurrentChat();
                }
            });
        });

        const rangeInput = this.counterElement.querySelector('.setting-range');
        const rangeValue = this.counterElement.querySelector('.range-value');
        
        rangeInput?.addEventListener('input', (e) => {
            const value = e.target.value;
            rangeValue.textContent = value + '%';
            this.settings.warningThreshold = parseInt(value);
            this.saveSettings();
            this.checkLimits();
        });
    }

    toggleCounter() {
        const content = this.counterElement.querySelector('.token-counter-content');
        const toggleBtn = this.counterElement.querySelector('.toggle-btn');
        
        content.classList.toggle('hidden');
        toggleBtn.textContent = content.classList.contains('hidden') ? '+' : '−';
        
        this.settings.isCollapsed = content.classList.contains('hidden');
        this.saveSettings();
    }

    toggleSettings() {
        const settings = this.counterElement.querySelector('.token-counter-settings');
        const main = this.counterElement.querySelector('.token-counter-main');
        
        settings.classList.toggle('hidden');
        main.classList.toggle('hidden');
    }

    toggleVisibility(visible) {
        if (this.counterElement) {
            this.counterElement.style.display = visible ? 'block' : 'none';
        }
    }

    resetCounter() {
        this.currentTokens = 0;
        this.estimatedWords = 0;
        this.usagePercentage = 0;
        this.updateCounterDisplay();
        this.showNotification('Счетчик сброшен', 'success');
    }

    updateCounterDisplay() {
        if (!this.counterElement) return;

        const currentElement = this.counterElement.querySelector('.current-tokens');
        const progressFill = this.counterElement.querySelector('.progress-fill');
        const progressPercentage = this.counterElement.querySelector('.progress-percentage');
        const charCountElement = this.counterElement.querySelector('.stats-info .stat-item:nth-child(1) .stat-value');
        const wordCountElement = this.counterElement.querySelector('.stats-info .stat-item:nth-child(2) .stat-value');
        
        if (currentElement) {
            currentElement.textContent = this.formatTokens(this.currentTokens);
        }
        
        if (progressFill) {
            progressFill.style.width = `${this.usagePercentage}%`;
            
            if (this.usagePercentage >= this.settings.warningThreshold) {
                progressFill.style.background = '#dc2626';
            } else if (this.usagePercentage >= this.settings.warningThreshold - 20) {
                progressFill.style.background = '#f59e0b';
            } else {
                progressFill.style.background = '#10b981';
            }
        }
        
        if (progressPercentage) {
            progressPercentage.textContent = `${Math.round(this.usagePercentage)}%`;
        }

        if (charCountElement) {
            const totalChars = this.conversationHistory.reduce((sum, msg) => sum + msg.text.length, 0);
            charCountElement.textContent = this.formatNumber(totalChars);
        }

        if (wordCountElement) {
            wordCountElement.textContent = this.formatNumber(this.estimatedWords);
        }

        this.updateInputCounter();
    }

    formatTokens(tokens) {
        if (tokens >= 1000) {
            return (tokens / 1000).toFixed(1) + 'K';
        }
        return tokens.toString();
    }

    formatNumber(num) {
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    checkLimits() {
        if (!this.settings.showWarnings || !this.counterElement) return;

        const warningsContainer = this.counterElement.querySelector('.token-counter-warnings');
        warningsContainer.innerHTML = '';

        if (this.usagePercentage >= 95) {
            this.showWarning(
                '❌ Контекст почти переполнен! Рекомендуется начать новый чат.',
                'error',
                warningsContainer
            );
        } else if (this.usagePercentage >= this.settings.warningThreshold) {
            this.showWarning(
                `⚠️ Контекст заполнен на ${Math.round(this.usagePercentage)}%`,
                'warning',
                warningsContainer
            );
        }

        const inputTokens = this.estimateInputTokens();
        if (inputTokens > this.responseLimit) {
            this.showWarning(
                `❌ Сообщение слишком длинное (${inputTokens} токенов) - сократите текст`,
                'error',
                warningsContainer
            );
        } else if (inputTokens > this.responseLimit * 0.8) {
            this.showWarning(
                `⚠️ Сообщение близко к лимиту (${inputTokens} токенов)`,
                'warning',
                warningsContainer
            );
        }
        
        if (this.settings.showTips && this.usagePercentage > 50) {
            this.showWarning(
                '💡 Совет: Для длинных диалогов можно редактировать предыдущие сообщения',
                'info',
                warningsContainer
            );
        }
    }

    showWarning(message, type, container) {
        const warning = document.createElement('div');
        warning.className = `token-warning token-warning-${type}`;
        warning.innerHTML = message;
        container.appendChild(warning);
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `token-notification token-notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#dc2626' : type === 'warning' ? '#f59e0b' : '#10b981'};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            z-index: 10000;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 300px;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 4000);
    }

    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        if (this.chatObserver) {
            this.chatObserver.disconnect();
        }
        if (this.counterElement && this.counterElement.parentNode) {
            this.counterElement.parentNode.removeChild(this.counterElement);
        }
    }
}

let authManager = null;
let chatOrganizerInstance = null;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        authManager = new AuthManager();
        const isAuthenticated = await authManager.checkAuthentication();
        
        if (isAuthenticated && !window.chatOrganizerInstance) {
            window.chatOrganizerInstance = new ChatOrganizer();
        }
    });
} else {
    authManager = new AuthManager();
    authManager.checkAuthentication().then(isAuthenticated => {
        if (isAuthenticated && !window.chatOrganizerInstance) {
            window.chatOrganizerInstance = new ChatOrganizer();
        }
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (window.chatOrganizerInstance) {
        window.chatOrganizerInstance.handleMessages(request);
    }
    
    sendResponse({ status: 'processed' });
    return true;
});

window.addEventListener('beforeunload', () => {
    if (window.chatOrganizerInstance) {
        window.chatOrganizerInstance.destroy();
    }
    if (authManager) {
        authManager.destroy();
    }
});