class AuthService {
    constructor() {
        this.validTokens = new Set();
        this.init();
    }

    async init() {
        await this.loadValidTokens();
        this.setupEventListeners();
        await this.checkExistingAuth();
    }

    async loadValidTokens() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/YOUR_USERNAME/deepseek-organizer/main/tokens.json?t=' + Date.now());
            if (response.ok) {
                const tokensData = await response.json();
                tokensData.validTokens.forEach(token => this.validTokens.add(token));
            }
        } catch (error) {
            console.log('Используем локальный список токенов');
            const backupTokens = [
                'DEEPSEEK-2024-ORG',
                'AS1MSONZ-PREMIUM',
                'CHAT-ORGANIZER-V1'
            ];
            backupTokens.forEach(token => this.validTokens.add(token));
        }
    }

    setupEventListeners() {
        document.getElementById('activate-btn').addEventListener('click', () => {
            this.activateToken();
        });

        document.getElementById('token-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.activateToken();
            }
        });
    }

    async checkExistingAuth() {
        const result = await chrome.storage.local.get(['authToken', 'authValidUntil']);
        const now = Date.now();
        
        if (result.authToken && result.authValidUntil && result.authValidUntil > now) {
            this.showSuccess('Расширение уже активировано!');
            setTimeout(() => {
                window.close();
            }, 2000);
        }
    }

    async activateToken() {
        const tokenInput = document.getElementById('token-input');
        const token = tokenInput.value.trim();
        
        if (!token) {
            this.showError('Введите токен доступа');
            return;
        }

        if (this.validTokens.has(token)) {
            const validUntil = Date.now() + (30 * 24 * 60 * 60 * 1000);
            
            await chrome.storage.local.set({
                authToken: token,
                authValidUntil: validUntil,
                isActivated: true
            });

            this.showSuccess('Расширение успешно активировано!');
            
            const tabs = await chrome.tabs.query({ 
                url: ['https://chat.deepseek.com/*', 'https://*.deepseek.com/*'] 
            });
            
            tabs.forEach(tab => {
                chrome.tabs.reload(tab.id);
            });
            
            setTimeout(() => {
                window.close();
            }, 2000);
            
        } else {
            this.showError('Неверный токен доступа');
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error-message');
        const successEl = document.getElementById('success-message');
        
        successEl.style.display = 'none';
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }

    showSuccess(message) {
        const errorEl = document.getElementById('error-message');
        const successEl = document.getElementById('success-message');
        
        errorEl.style.display = 'none';
        successEl.textContent = message;
        successEl.style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AuthService();
});