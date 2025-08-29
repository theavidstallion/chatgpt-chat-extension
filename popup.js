let currentTab = 'all';
let allChats = [];
let favorites = [];

// Initialize the popup
document.addEventListener('DOMContentLoaded', () => {
    loadChats();
    setupEventListeners();
    
    // Add message listener for updates from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CHATS_UPDATED') {
            loadChats();
        }
    });
    
    // Force content script to refresh chats when popup opens
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const currentTab = tabs[0];
        if (currentTab && (currentTab.url.includes('chat.openai.com') || currentTab.url.includes('chatgpt.com'))) {
            chrome.tabs.sendMessage(currentTab.id, { type: 'REFRESH_CHATS' });
        }
    });
});

// Load chats from storage
function loadChats() {
    chrome.storage.local.get(['allChats', 'favorites'], (result) => {
        console.log('Loaded from storage:', result); // Debug log
        
        // Sort chats by lastSeen timestamp
        allChats = (result.allChats || []).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        favorites = result.favorites || [];
        
        // Update counts in the UI
        const allChatsTab = document.querySelector('[data-tab="all"]');
        const favTab = document.querySelector('[data-tab="favorites"]');
        
        // Remove existing count spans if they exist
        allChatsTab.querySelectorAll('span').forEach(span => span.remove());
        favTab.querySelectorAll('span').forEach(span => span.remove());
        
        // Add new count spans
        const totalCount = document.createElement('span');
        totalCount.style.marginLeft = '8px';
        totalCount.style.color = '#666';
        totalCount.style.fontSize = '12px';
        totalCount.textContent = `(${allChats.length})`;
        allChatsTab.appendChild(totalCount);
        
        const favCount = document.createElement('span');
        favCount.style.marginLeft = '8px';
        favCount.style.color = '#666';
        favCount.style.fontSize = '12px';
        favCount.textContent = `(${favorites.length})`;
        favTab.appendChild(favCount);
        
        updateDisplay();
    });
}

// Set up event listeners
function setupEventListeners() {
    // Search input
    document.getElementById('searchInput').addEventListener('input', (e) => {
        updateDisplay(e.target.value);
    });

    // Tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;
            updateDisplay();
        });
    });
}

// Update the display based on current tab and search query
function updateDisplay(searchQuery = '') {
    const chatList = document.getElementById('chatList');
    chatList.innerHTML = '';

    let displayChats = currentTab === 'all' ? allChats : favorites;
    console.log('Display chats before filter:', displayChats); // Debug log
    
    if (searchQuery) {
        searchQuery = searchQuery.toLowerCase();
        displayChats = displayChats.filter(chat => 
            chat.title.toLowerCase().includes(searchQuery) ||
            (chat.category && chat.category.toLowerCase().includes(searchQuery))
        );
        console.log('Filtered chats:', displayChats); // Debug log
    }

    if (displayChats.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.style.padding = '16px';
        emptyMessage.style.textAlign = 'center';
        emptyMessage.style.color = '#666';
        emptyMessage.textContent = currentTab === 'all' ? 
            'No chats found. Please visit chatgpt.com to load your chats.' :
            'No favorite chats found. Star some chats to see them here.';
        chatList.appendChild(emptyMessage);
        return;
    }

    displayChats.forEach(chat => {
        const isFavorite = favorites.some(f => f.url === chat.url);
        const chatElement = createChatElement(chat, isFavorite);
        chatList.appendChild(chatElement);
    });
}

// Create a chat list item element
function createChatElement(chat, isFavorite) {
    const div = document.createElement('div');
    div.className = 'chat-item';

    if (chat.category) {
        const category = document.createElement('span');
        category.className = 'category';
        category.textContent = chat.category;
        div.appendChild(category);
    }

    const link = document.createElement('a');
    link.href = chat.url;
    link.className = 'chat-title';
    link.textContent = chat.title;
    link.target = '_blank';
    div.appendChild(link);

    const starBtn = document.createElement('button');
    starBtn.className = 'star-btn' + (isFavorite ? ' active' : '');
    starBtn.textContent = '★'; // Using black star Unicode character
    starBtn.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
    starBtn.addEventListener('click', () => toggleFavorite(chat));
    div.appendChild(starBtn);

    return div;
}

// Toggle favorite status of a chat
function toggleFavorite(chat) {
    const existingIndex = favorites.findIndex(f => f.url === chat.url);
    
    if (existingIndex === -1) {
        const category = prompt('Enter a category for this chat (e.g., Work, Personal, Study):');
        if (category) {
            favorites.push({ ...chat, category });
        }
    } else {
        favorites.splice(existingIndex, 1);
    }

    // Save to storage
    chrome.storage.local.set({ favorites }, () => {
        updateDisplay(document.getElementById('searchInput').value);
    });
}

// Optional: Function to switch to chrome.storage.sync
function switchToSync() {
    chrome.storage.local.get(['favorites'], (result) => {
        chrome.storage.sync.set({ favorites: result.favorites }, () => {
            console.log('Switched to sync storage');
        });
    });
}