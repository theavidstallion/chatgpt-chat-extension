// Debug logging helper
function log(message) {
    console.log(`[ChatGPT Manager] ${message}`);
}

// Function to scrape chat titles and URLs
async function scrapeChats(forceScroll = false) {
    log('Starting chat scrape' + (forceScroll ? ' with forced scroll' : ''));
    
    // First, load existing chats from storage
    const existingData = await new Promise(resolve => {
        chrome.storage.local.get(['allChats'], result => {
            resolve(result.allChats || []);
        });
    });

    // Create a Map of existing chats for easy lookup and deduplication
    const existingChatsMap = new Map(
        existingData.map(chat => [chat.url, chat])
    );

    // If forced scroll or initial load, scroll the sidebar first
    if (forceScroll) {
        log('Forcing sidebar scroll');
        await scrollSidebar();
    }

    // Function to scroll the sidebar to load more chats
    async function scrollSidebar() {
        // Wait for nav to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));

        const nav = document.querySelector('nav');
        if (!nav) {
            log('Nav element not found');
            return;
        }

        // Try to find the scrollable container
        const scrollableDiv = await findScrollableContainer(nav);
        if (!scrollableDiv) {
            log('Scrollable container not found');
            return;
        }

        log('Found scrollable div, starting auto-scroll');

        let previousChatCount = 0;
        let noNewChatsCount = 0;
        let attempts = 0;

        // Function to count current chats
        const countCurrentChats = () => {
            return document.querySelectorAll('nav a[href^="/c/"], nav a.flex').length;
        };

        // Click "Show more" if it exists
        await clickShowMoreButton();

        // Scroll gradually
        while (attempts < 200 && noNewChatsCount < 5) { // Increased max attempts
            const currentPosition = scrollableDiv.scrollTop;
            const targetPosition = Math.min(
                currentPosition + 300, // Scroll in smaller steps
                scrollableDiv.scrollHeight - scrollableDiv.clientHeight
            );
            
            // Smooth scroll to next position
            scrollableDiv.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
            
            // Wait for scroll and content load
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check if new chats were loaded
            const currentChatCount = countCurrentChats();
            if (currentChatCount > previousChatCount) {
                log(`Found ${currentChatCount - previousChatCount} new chats`);
                previousChatCount = currentChatCount;
                noNewChatsCount = 0; // Reset counter when we find new chats
            } else {
                noNewChatsCount++;
            }
            
            // If we're at the bottom, try clicking "Show more" again
            if (scrollableDiv.scrollTop + scrollableDiv.clientHeight >= scrollableDiv.scrollHeight) {
                await clickShowMoreButton();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            attempts++;
            log(`Scroll attempt ${attempts}, chats found: ${currentChatCount}`);
        }
        
        // Scroll back to top smoothly
        scrollableDiv.scrollTo({ top: 0, behavior: 'smooth' });
        log(`Auto-scroll complete, found ${previousChatCount} chats total`);
        
        // Wait for any final content to load
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Helper function to find scrollable container
    async function findScrollableContainer(nav) {
        const selectors = [
            'div[class*="scroll"]',
            'div[class*="overflow"]',
            'div[style*="overflow"]',
            'div'
        ];

        for (const selector of selectors) {
            const elements = nav.querySelectorAll(selector);
            const scrollable = Array.from(elements).find(el => {
                const style = getComputedStyle(el);
                return (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                       el.scrollHeight > el.clientHeight;
            });
            if (scrollable) return scrollable;
        }
        return null;
    }

    // Helper function to click "Show more" button
    async function clickShowMoreButton() {
        const showMoreButton = Array.from(document.querySelectorAll('button')).find(
            button => button.textContent.toLowerCase().includes('show more')
        );
        if (showMoreButton) {
            log('Found "Show more" button, clicking it');
            showMoreButton.click();
            await new Promise(resolve => setTimeout(resolve, 1500));
            return true;
        }
        return false;
    }

    // First scroll to load all chats
    await scrollSidebar();

    // Now scrape all visible chats
    const chatElements = document.querySelectorAll('nav a[href^="/c/"], nav a.flex');
    
    chatElements.forEach(chat => {
        const titleElement = chat.querySelector('div');
        const title = titleElement ? titleElement.textContent.trim() : chat.textContent.trim();
        const url = new URL(chat.href, window.location.origin).href;
        
        if (title && url && !title.includes('New chat')) {
            existingChatsMap.set(url, { title, url, lastSeen: Date.now() });
        }
    });

    // Extract chat timestamps and properly sort
    const allChats = Array.from(existingChatsMap.values()).map(chat => {
        // Try to extract date from the chat title first
        const dateMatch = chat.title.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})|(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
            const dateStr = dateMatch[0];
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
                chat.timestamp = parsedDate.getTime();
                return chat;
            }
        }

        // If no date in title, try to extract from URL
        const urlMatch = chat.url.match(/.*\/c\/(.*?)(?:\/|$)/);
        if (urlMatch) {
            const chatId = urlMatch[1];
            // ChatGPT uses UUID v4 which might contain creation time
            // Try to extract a timestamp from any numeric parts
            const numericParts = chatId.match(/\d+/g);
            if (numericParts && numericParts[0]) {
                chat.timestamp = parseInt(numericParts[0], 10) || Date.now();
                return chat;
            }
        }

        // Fallback to last seen time or current time
        chat.timestamp = chat.lastSeen || Date.now();
        return chat;
    }).sort((a, b) => {
        // Primary sort by timestamp (newest first)
        const timeSort = (b.timestamp || 0) - (a.timestamp || 0);
        if (timeSort !== 0) return timeSort;
        
        // Secondary sort by title
        return a.title.localeCompare(b.title);
    });

    // Save to chrome.storage.local
    chrome.storage.local.set({ 'allChats': allChats }, () => {
        console.log('Total chats saved:', allChats.length);
        // Notify the popup that new data is available
        chrome.runtime.sendMessage({ type: 'CHATS_UPDATED' });
    });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'REFRESH_CHATS') {
        scrapeChats();
    }
});

// Initial scrape with retry mechanism
async function initialScrape(retryCount = 0) {
    log(`Starting initial scrape (attempt ${retryCount + 1})`);
    
    try {
        // Wait for page to be properly loaded
        await new Promise(resolve => setTimeout(resolve, 2000));

        const nav = document.querySelector('nav');
        if (!nav && retryCount < 5) {
            log('Nav not found, retrying...');
            setTimeout(() => initialScrape(retryCount + 1), 2000 * (retryCount + 1));
            return;
        }

        // Force scroll on initial load
        await scrapeChats(true);
        
        // Set up periodic re-scraping
        setInterval(() => {
            scrapeChats(false);
        }, 30000); // Check for new chats every 30 seconds
        
    } catch (error) {
        log(`Error during initial scrape: ${error.message}`);
        if (retryCount < 5) {
            setTimeout(() => initialScrape(retryCount + 1), 2000 * (retryCount + 1));
        }
    }
}

// Start the initial scrape
log('Content script loaded, waiting for page to be ready');
setTimeout(() => initialScrape(), 3000);

// Set up MutationObserver to detect new chats
let debounceTimeout;
const observer = new MutationObserver((mutations) => {
    // Debounce the scrape to avoid multiple calls
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                scrapeChats();
                break;
            }
        }
    }, 1000);
});

// Start observing the sidebar for changes
function initializeObserver() {
    const sidebar = document.querySelector('nav');
    if (sidebar) {
        observer.observe(sidebar, {
            childList: true,
            subtree: true
        });
    } else {
        // Retry if sidebar isn't loaded yet
        setTimeout(initializeObserver, 1000);
    }
}

initializeObserver();
