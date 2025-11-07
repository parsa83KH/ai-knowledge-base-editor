const FIREBASE_PATH = 'knowledgeBaseChanges'; // Path in Firebase Realtime Database
let originalData = {};
let currentData = {};
let activeKey = null; // To track the currently displayed section
let searchInput = null;

// Firebase doesn't allow certain characters in keys: ".", "#", "$", "/", "[", "]"
// We need to encode/decode paths for Firebase storage
function encodeFirebaseKey(key) {
    if (!key || typeof key !== 'string') return key;
    return key
        .replace(/\[/g, '__LBRACK__')
        .replace(/\]/g, '__RBRACK__')
        .replace(/\./g, '__DOT__')
        .replace(/#/g, '__HASH__')
        .replace(/\$/g, '__DOLLAR__')
        .replace(/\//g, '__SLASH__');
}

function decodeFirebaseKey(key) {
    return key
        .replace(/__DOT__/g, '.')
        .replace(/__HASH__/g, '#')
        .replace(/__DOLLAR__/g, '$')
        .replace(/__SLASH__/g, '/')
        .replace(/__LBRACK__/g, '[')
        .replace(/__RBRACK__/g, ']');
}

function encodeChangesForFirebase(changes) {
    const encoded = {};
    
    if (changes.modifications) {
        encoded.modifications = {};
        for (const key in changes.modifications) {
            encoded.modifications[encodeFirebaseKey(key)] = changes.modifications[key];
        }
    }
    
    if (changes.notes) {
        encoded.notes = {};
        for (const key in changes.notes) {
            encoded.notes[encodeFirebaseKey(key)] = changes.notes[key];
        }
    }
    
    return encoded;
}

function decodeChangesFromFirebase(encodedChanges) {
    if (!encodedChanges) return null;
    
    const changes = {};
    
    if (encodedChanges.modifications) {
        changes.modifications = {};
        for (const key in encodedChanges.modifications) {
            changes.modifications[decodeFirebaseKey(key)] = encodedChanges.modifications[key];
        }
    }
    
    if (encodedChanges.notes) {
        changes.notes = {};
        for (const key in encodedChanges.notes) {
            changes.notes[decodeFirebaseKey(key)] = encodedChanges.notes[key];
        }
    }
    
    return changes;
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize app directly without login
    loadKnowledgeBaseAndInitializeApp();

    // --- Save, Undo, Export, and Search Functionality ---
    document.getElementById('save-changes-btn')?.addEventListener('click', saveChanges);
    document.getElementById('undo-all-btn')?.addEventListener('click', undoAllChanges);
    document.getElementById('export-changes-btn')?.addEventListener('click', exportChanges);
    searchInput = document.getElementById('search-input');
    searchInput?.addEventListener('input', handleSearch);
});


async function loadKnowledgeBaseAndInitializeApp() {
    try {
        showLoader('در حال بارگذاری پایگاه دانش...');
        
        // Fetch and initialize data
        const response = await fetch('./knowledgeBase.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        originalData = JSON.parse(JSON.stringify(data)); // Deep copy for comparison

        // Load changes from Firebase only
        let savedChanges = null;
        
        try {
            savedChanges = await loadChangesFromCloud();
            if (savedChanges) {
                showNotification('تغییرات از فضای ابری بارگذاری شد.', 'success');
            }
        } catch (cloudError) {
            console.log("Could not load from cloud:", cloudError);
            if (cloudError.message && !cloudError.message.includes('Firebase is not configured')) {
                showNotification('خطا در بارگذاری از فضای ابری. از داده‌های اصلی استفاده می‌شود.', 'error');
            }
        }

        if (savedChanges) {
            // Start with a fresh copy of originalData and apply saved changes
            currentData = applyChanges(JSON.parse(JSON.stringify(originalData)), savedChanges);
        } else {
            // No saved changes, start with the original data
            currentData = JSON.parse(JSON.stringify(originalData));
        }

        hideLoader();
        initializeApp();
    } catch (error) {
        hideLoader();
        console.error("Error loading knowledge base:", error);
        const contentArea = document.getElementById('content-area');
        if(contentArea) {
            contentArea.innerHTML = `<p class="text-red-500">خطا در بارگذاری پایگاه دانش. لطفا فایل knowledgeBase.json را بررسی کنید.</p>`;
        }
    }
}


function applyChanges(data, changes) {
    const setNestedValue = (obj, path, value) => {
        const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(k => k);
        let temp = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            const nextKey = keys[i + 1];
            if (!temp[key] || typeof temp[key] !== 'object') {
                temp[key] = /^\d+$/.test(nextKey) ? [] : {};
            }
            temp = temp[key];
        }
        temp[keys[keys.length - 1]] = value;
    };

    if (changes.modifications) {
        for (const path in changes.modifications) {
            setNestedValue(data, path, changes.modifications[path]);
        }
    }
    if (changes.notes) {
        for (const path in changes.notes) {
            setNestedValue(data, path, changes.notes[path]);
        }
    }
    return data;
}


function initializeApp() {
    const navigation = document.getElementById('navigation');
    if (!navigation) return;

    navigation.innerHTML = ''; // Clear previous entries
    Object.keys(currentData).forEach(key => {
        const navItem = document.createElement('a');
        navItem.href = '#';
        navItem.textContent = key.replace(/_/g, ' ');
        navItem.className = 'block py-2 px-3 rounded-md hover:bg-[#38bdf8] hover:text-white transition-all';
        navItem.onclick = (e) => {
            e.preventDefault();
            activeKey = key;

            // Clear search input when a category is selected
            if (searchInput) {
                searchInput.value = '';
            }

            renderContent(key, currentData[key]);
            
            document.querySelectorAll('#navigation a').forEach(link => {
                link.classList.remove('primary-bg', 'text-white');
                link.style.backgroundColor = '';
            });
            navItem.classList.add('text-white');
            navItem.style.backgroundColor = '#38bdf8';


            const mainContent = document.querySelector('main');
            if (mainContent) {
                mainContent.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };
        navigation.appendChild(navItem);
    });
}

function renderContent(title, data) {
    const contentArea = document.getElementById('content-area');
    const contentTitle = document.getElementById('content-title');
    if (!contentArea || !contentTitle) return;

    contentTitle.textContent = title.replace(/_/g, ' ');
    contentArea.innerHTML = '';

    // --- General Note Section ---
    const generalNoteContainer = document.createElement('div');
    generalNoteContainer.className = 'p-4 mb-6 bg-blue-900/20 border-l-4 border-blue-500 rounded-md';
    contentArea.appendChild(generalNoteContainer);

    const renderGeneralNoteUI = () => {
        generalNoteContainer.innerHTML = '';
        const generalNoteKey = '_general_note';
        const note = currentData[title]?.[generalNoteKey];

        if (note) {
            const noteHeader = document.createElement('div');
            noteHeader.className = 'flex justify-between items-center mb-2';
            
            const noteTitle = document.createElement('h4');
            noteTitle.textContent = 'یادداشت کلی مجموعه';
            noteTitle.className = 'font-semibold text-blue-300';
            noteHeader.appendChild(noteTitle);

            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'flex items-center gap-2';

            const editBtn = document.createElement('button');
            editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>`;
            editBtn.title = 'ویرایش یادداشت کلی';
            editBtn.className = 'p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors';
            editBtn.onclick = () => showGeneralNoteEditor(note);
            buttonsDiv.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
            deleteBtn.title = 'حذف یادداشت کلی';
            deleteBtn.className = 'p-1 rounded-full text-gray-400 hover:text-white hover:bg-red-500/50 transition-colors';
            deleteBtn.onclick = () => {
                delete currentData[title][generalNoteKey];
                renderGeneralNoteUI();
                showNotification('یادداشت کلی حذف شد.', 'info');
            };
            buttonsDiv.appendChild(deleteBtn);
            noteHeader.appendChild(buttonsDiv);
            generalNoteContainer.appendChild(noteHeader);

            const noteText = document.createElement('p');
            noteText.textContent = note;
            noteText.className = 'whitespace-pre-wrap text-gray-300';
            generalNoteContainer.appendChild(noteText);
        } else {
            const addNoteBtn = document.createElement('button');
            addNoteBtn.textContent = 'افزودن یادداشت کلی برای این مجموعه';
            addNoteBtn.className = 'px-3 py-2 text-sm secondary-bg text-white rounded-md secondary-hover-bg transition-all';
            addNoteBtn.onclick = () => showGeneralNoteEditor();
            generalNoteContainer.appendChild(addNoteBtn);
        }
    };

    const showGeneralNoteEditor = (existingNote = '') => {
        generalNoteContainer.innerHTML = '';
        const generalNoteKey = '_general_note';

        const noteTitle = document.createElement('h4');
        noteTitle.textContent = existingNote ? 'ویرایش یادداشت کلی' : 'افزودن یادداشت کلی';
        noteTitle.className = 'font-semibold text-blue-300 mb-2';
        generalNoteContainer.appendChild(noteTitle);

        const textarea = document.createElement('textarea');
        textarea.value = existingNote;
        textarea.className = 'w-full p-2 rounded-md bg-[#111827] border border-color focus-ring';
        textarea.placeholder = 'یادداشت کلی خود را اینجا بنویسید...';
        textarea.rows = 3;
        generalNoteContainer.appendChild(textarea);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'mt-2 flex gap-2';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'ذخیره یادداشت';
        saveBtn.className = 'px-3 py-1 primary-bg text-white rounded-md primary-hover-bg transition-all text-sm';
        saveBtn.onclick = () => {
            const newNote = textarea.value.trim();
            if (newNote) {
                if (!currentData[title]) currentData[title] = {};
                currentData[title][generalNoteKey] = newNote;
                showNotification('یادداشت کلی ذخیره شد.', 'success');
            } else {
                if (currentData[title]) delete currentData[title][generalNoteKey];
                showNotification('یادداشت کلی حذف شد.', 'info');
            }
            renderGeneralNoteUI();
        };
        actionsDiv.appendChild(saveBtn);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'لغو';
        cancelButton.className = 'px-3 py-1 secondary-bg text-white rounded-md secondary-hover-bg transition-all text-sm';
        cancelButton.onclick = () => renderGeneralNoteUI();
        actionsDiv.appendChild(cancelButton);
        
        generalNoteContainer.appendChild(actionsDiv);
        textarea.focus();
    };

    renderGeneralNoteUI();
    
    // --- Render main content ---
    const container = document.createElement('div');
    container.className = 'fade-in';
    
    parseAndRender(data, container, title);
    contentArea.appendChild(container);
}

function parseAndRender(data, parentElement, currentPath) {
    if (Array.isArray(data)) {
        const list = document.createElement('ul');
        list.className = 'list-disc list-inside space-y-2 pl-4';
        data.forEach((item, index) => {
            const listItem = document.createElement('li');
            listItem.className = "pl-2";
            parseAndRender(item, listItem, `${currentPath}[${index}]`);
            list.appendChild(listItem);
        });
        parentElement.appendChild(list);
    } else if (typeof data === 'object' && data !== null) {
        Object.entries(data).forEach(([key, value]) => {
            if (key.endsWith('_notes') || key === '_general_note') return;

            const section = document.createElement('div');
            section.className = 'p-4 border border-color rounded-lg bg-card mb-4';
            
            const title = document.createElement('h3');
            title.className = 'text-xl font-semibold mb-2 primary-color';
            title.textContent = key.replace(/_/g, ' ');
            section.appendChild(title);
            
            parseAndRender(value, section, `${currentPath}.${key}`);
            parentElement.appendChild(section);
        });
    } else {
        const itemContainer = document.createElement('div');
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'flex items-start gap-2 group';

        const textElement = document.createElement('span');
        textElement.textContent = String(data);
        textElement.setAttribute('contenteditable', 'true');
        textElement.className = 'flex-grow p-1 rounded-md focus:outline-none focus:ring-2 focus-ring';
        textElement.onblur = (e) => {
             const oldValue = getNestedValue(currentData, currentPath);
             const newValue = e.target.innerText;
             if(oldValue !== newValue) {
                updateData(currentPath, newValue);
             }
        };
        contentWrapper.appendChild(textElement);

        const noteButton = document.createElement('button');
        noteButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-50 group-hover:opacity-100 transition-opacity" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>`;
        noteButton.title = 'افزودن یادداشت';
        noteButton.className = 'mt-1 text-gray-400 hover:text-white';
        noteButton.onclick = () => showInlineNoteEditor(itemContainer, currentPath);
        contentWrapper.appendChild(noteButton);
        
        itemContainer.appendChild(contentWrapper);
        parentElement.appendChild(itemContainer);

        // Check for and render existing notes
        const notesPath = `${currentPath}_notes`;
        const notes = getNestedValue(currentData, notesPath);
        if (Array.isArray(notes)) {
            notes.forEach((note, index) => {
                renderNoteDisplay(itemContainer, currentPath, note, index);
            });
        }
    }
}

function renderNoteDisplay(container, path, noteValue, noteIndex) {
    const noteDisplay = document.createElement('div');
    noteDisplay.className = 'mt-2 p-3 bg-yellow-900/30 text-yellow-300 border-r-4 border-yellow-500 rounded-md text-sm flex justify-between items-center';
    
    const noteTextSpan = document.createElement('span');
    noteTextSpan.textContent = noteValue;
    noteTextSpan.className = 'flex-grow';

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'flex items-center gap-2 flex-shrink-0';

    const editBtn = document.createElement('button');
    editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>`;
    editBtn.title = 'ویرایش یادداشت';
    editBtn.className = 'p-1 rounded-full hover:bg-white/20 transition-colors';
    editBtn.onclick = () => showInlineNoteEditor(container, path, noteValue, noteIndex);

    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
    deleteBtn.title = 'حذف یادداشت';
    deleteBtn.className = 'p-1 rounded-full hover:bg-red-500/50 transition-colors';
    deleteBtn.onclick = () => deleteNote(path, noteIndex);

    buttonsDiv.appendChild(editBtn);
    buttonsDiv.appendChild(deleteBtn);
    noteDisplay.appendChild(noteTextSpan);
    noteDisplay.appendChild(buttonsDiv);
    container.appendChild(noteDisplay);
}

function deleteNote(path, index) {
    const notesPath = `${path}_notes`;
    let notes = getNestedValue(currentData, notesPath);
    if (Array.isArray(notes)) {
        notes.splice(index, 1);
        if (notes.length === 0) {
            updateData(notesPath, undefined); // Remove the notes property if empty
        } else {
            updateData(notesPath, notes);
        }
        
        const query = searchInput?.value.trim();
        if (query) {
            performSearch(query);
        } else if (activeKey) {
            renderContent(activeKey, currentData[activeKey]);
        }
    }
}


function showInlineNoteEditor(container, path, existingNote = '', noteIndex = -1) {
    // Remove any other note editors in the same container
    const oldEditor = container.querySelector('.note-input-container');
    if (oldEditor) oldEditor.remove();

    // If we're editing, hide the static display of the note being edited
    if (noteIndex > -1) {
        // Find the correct note display to hide
        const noteDisplays = container.querySelectorAll('.flex.justify-between.items-center');
        if(noteDisplays[noteIndex]) {
            noteDisplays[noteIndex].style.display = 'none';
        }
    }

    const noteContainer = document.createElement('div');
    noteContainer.className = 'note-input-container mt-2 p-2 border-t border-color';

    const noteInput = document.createElement('textarea');
    noteInput.value = existingNote;
    noteInput.placeholder = 'یادداشت جدید...';
    noteInput.className = 'w-full p-2 rounded-md bg-[#111827] border border-color focus-ring';
    noteInput.rows = 2;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'mt-2 flex gap-2';
    
    const saveButton = document.createElement('button');
    saveButton.textContent = 'ذخیره';
    saveButton.className = 'px-3 py-1 primary-bg text-white rounded-md primary-hover-bg transition-all text-sm';

    saveButton.onclick = () => {
        const noteText = noteInput.value.trim();
        if (!noteText) return;
        
        const notesPath = `${path}_notes`;
        let notes = getNestedValue(currentData, notesPath);

        if (noteIndex > -1) { // Editing existing note
            notes[noteIndex] = noteText;
        } else { // Adding new note
            if (!Array.isArray(notes)) notes = [];
            notes.push(noteText);
        }
        
        updateData(notesPath, notes);
        
        const query = searchInput?.value.trim();
        if (query) {
            performSearch(query);
        } else if (activeKey) {
            renderContent(activeKey, currentData[activeKey]);
        }
    };

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'لغو';
    cancelButton.className = 'px-3 py-1 secondary-bg text-white rounded-md secondary-hover-bg transition-all text-sm';
    cancelButton.onclick = () => {
        // Just re-render to cancel the edit
        const query = searchInput?.value.trim();
        if (query) {
            performSearch(query);
        } else if (activeKey) {
            renderContent(activeKey, currentData[activeKey]);
        }
    };
    
    actionsDiv.appendChild(saveButton);
    actionsDiv.appendChild(cancelButton);
    noteContainer.appendChild(noteInput);
    noteContainer.appendChild(actionsDiv);
    container.appendChild(noteContainer);
    noteInput.focus();
}

async function undoAllChanges() {
    const changes = findChanges(originalData, currentData);
    if (Object.keys(changes.modifications || {}).length === 0 && Object.keys(changes.notes || {}).length === 0) {
        showNotification('هیچ تغییری برای بازگردانی وجود ندارد.', 'info');
        return;
    }

    try {
        showLoader('در حال بازگردانی تغییرات...');
        
        // Reset data to original
        currentData = JSON.parse(JSON.stringify(originalData));
        
        // Clear Firebase data
        if (window.firebaseDatabase && window.firebaseRef && window.firebaseSet) {
            const database = window.firebaseDatabase;
            const dbRef = window.firebaseRef(database, FIREBASE_PATH);
            await window.firebaseSet(dbRef, null);
        }
        
        hideLoader();
        
        if (activeKey) {
            renderContent(activeKey, currentData[activeKey]);
        }

        showNotification('تمام تغییرات با موفقیت بازگردانده شد.', 'success');
    } catch (error) {
        hideLoader();
        console.error("Error undoing changes:", error);
        showNotification('خطا در بازگردانی تغییرات.', 'error');
    }
}


function updateData(path, value) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(k => k);
    let obj = currentData;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) {
             obj[keys[i]] = (keys[i+1].match(/^\d+$/)) ? [] : {};
        }
        obj = obj[keys[i]];
    }
    if (value === undefined) {
        delete obj[keys[keys.length - 1]];
    } else {
        obj[keys[keys.length - 1]] = value;
    }
}

function getNestedValue(obj, path) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(k => k);
    let current = obj;
    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return undefined;
        }
    }
    return current;
}

function findChanges(original, current) {
    const modifications = {};
    const notes = {};

    function recurse(origObj, currObj, path) {
        if (typeof currObj !== 'object' || currObj === null) {
            if (JSON.stringify(currObj) !== JSON.stringify(origObj)) {
                modifications[path] = currObj;
            }
            return;
        }

        const allKeys = new Set([...Object.keys(currObj), ...(typeof origObj === 'object' && origObj ? Object.keys(origObj) : [])]);

        for (const key of allKeys) {
            const currentPath = path ? `${path}.${key}` : key;
            const currValue = currObj[key];
            const origValue = (typeof origObj === 'object' && origObj) ? origObj[key] : undefined;

            if (key.endsWith('_notes') || key === '_general_note') {
                if (JSON.stringify(currValue) !== JSON.stringify(origValue)) {
                     if (currValue && ((Array.isArray(currValue) && currValue.length > 0) || typeof currValue === 'string')) {
                        notes[currentPath] = currValue;
                    }
                }
                continue;
            }
            
            if (typeof currValue === 'object' && currValue !== null && !Array.isArray(currValue)) {
                recurse(origValue, currValue, currentPath);
            } else {
                 if (JSON.stringify(currValue) !== JSON.stringify(origValue)) {
                    modifications[currentPath] = currValue;
                }
            }
        }
    }

    recurse(original, current, '');
    
    const finalChanges = {};
    if (Object.keys(modifications).length > 0) finalChanges.modifications = modifications;
    if (Object.keys(notes).length > 0) finalChanges.notes = notes;
    
    return finalChanges;
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    container.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function showLoader(message = 'در حال بارگذاری...') {
    const loaderOverlay = document.getElementById('loader-overlay');
    const loaderText = loaderOverlay?.querySelector('p.text-lg');
    if (loaderOverlay) {
        loaderOverlay.classList.remove('hidden');
        if (loaderText) {
            loaderText.textContent = message;
        }
    }
}

function hideLoader() {
    const loaderOverlay = document.getElementById('loader-overlay');
    if (loaderOverlay) {
        loaderOverlay.classList.add('hidden');
    }
}


async function saveChanges() {
    const changes = findChanges(originalData, currentData);
    if (Object.keys(changes.modifications || {}).length === 0 && Object.keys(changes.notes || {}).length === 0) {
        showNotification('هیچ تغییری برای ذخیره وجود ندارد.', 'info');
        return;
    }

    try {
        showLoader('در حال ذخیره تغییرات در فضای ابری...');
        await saveChangesToCloud(changes);
        hideLoader();
        showNotification('تغییرات با موفقیت در فضای ابری ذخیره شد.', 'success');
    } catch (cloudError) {
        hideLoader();
        console.error("Failed to save to cloud:", cloudError);
        if (cloudError.message && cloudError.message.includes('Firebase is not configured')) {
            showNotification('برای ذخیره در فضای ابری، لطفا Firebase را در فایل index.html تنظیم کنید.', 'error');
        } else {
            showNotification('خطا در ذخیره تغییرات در فضای ابری.', 'error');
        }
    }
}

async function saveChangesToCloud(changes) {
    // Check if Firebase is available
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseSet) {
        throw new Error('Firebase is not configured. Please set up Firebase in index.html');
    }

    try {
        // Encode changes to make Firebase-compatible keys
        const encodedChanges = encodeChangesForFirebase(changes);
        console.log('Original changes:', changes);
        console.log('Encoded changes:', encodedChanges);
        const database = window.firebaseDatabase;
        const dbRef = window.firebaseRef(database, FIREBASE_PATH);
        await window.firebaseSet(dbRef, encodedChanges);
        return { success: true };
    } catch (error) {
        console.error('Firebase save error:', error);
        console.error('Changes that failed:', changes);
        throw new Error(`Failed to save to Firebase: ${error.message}`);
    }
}

async function loadChangesFromCloud() {
    // Check if Firebase is available
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseGet) {
        return null; // Silently fail if Firebase not configured
    }

    try {
        const database = window.firebaseDatabase;
        const dbRef = window.firebaseRef(database, FIREBASE_PATH);
        const snapshot = await window.firebaseGet(dbRef);
        
        if (snapshot.exists()) {
            const encodedChanges = snapshot.val();
            // Decode changes from Firebase format
            return decodeChangesFromFirebase(encodedChanges);
        }
        return null;
    } catch (error) {
        console.error('Firebase load error:', error);
        throw error;
    }
}

function buildChangesObject(flatMap) {
    const result = {};
    const setNestedValue = (obj, path, value) => {
        const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(k => k);
        let temp = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            const nextKey = keys[i + 1];
            if (!temp[key] || typeof temp[key] !== 'object') {
                temp[key] = /^\d+$/.test(nextKey) ? [] : {};
            }
            temp = temp[key];
        }
        if (keys.length > 0) {
           temp[keys[keys.length - 1]] = value;
        }
    };

    for (const path in flatMap) {
        setNestedValue(result, path, flatMap[path]);
    }
    return result;
}

function exportChanges() {
    const changes = findChanges(originalData, currentData);
     if (Object.keys(changes.modifications || {}).length === 0 && Object.keys(changes.notes || {}).length === 0) {
        showNotification('هیچ تغییری برای خروجی گرفتن وجود ندارد.', 'info');
        return;
    }

    const exportMap = { ...(changes.modifications || {}) };

    if (changes.notes) {
        for (const notePath in changes.notes) {
            exportMap[notePath] = changes.notes[notePath];
            if (notePath.endsWith('_notes')) {
                const dataPath = notePath.replace(/_notes$/, '');
                if (!(dataPath in exportMap)) {
                    const value = getNestedValue(currentData, dataPath);
                    if (value !== undefined) {
                       exportMap[dataPath] = value;
                    }
                }
            }
        }
    }

    const changesObject = buildChangesObject(exportMap);

    const jsonString = JSON.stringify(changesObject, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'knowledgeBase_changes.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('فایل خروجی با موفقیت ایجاد شد.', 'success');
}

// --- Search Functionality ---

function handleSearch(event) {
    const query = event.target.value.toLowerCase().trim();
    if (!query) {
        clearSearchAndRestoreView();
    } else {
        performSearch(query);
    }
}

function performSearch(query) {
    const results = [];
    
    function searchRecursively(data, path) {
        if (data === null || typeof data === 'undefined') {
            return;
        }

        if (Array.isArray(data)) {
            data.forEach((item, index) => {
                searchRecursively(item, `${path}[${index}]`);
            });
        } else if (typeof data === 'object') {
            Object.entries(data).forEach(([key, value]) => {
                if (key.endsWith('_notes') || key === '_general_note') return;
                const newPath = path ? `${path}.${key}` : key;
                searchRecursively(value, newPath);
            });
        } else if (typeof data === 'string') {
            if (data.toLowerCase().includes(query)) {
                results.push({ path, value: data });
            }
        }
    }

    searchRecursively(currentData, '');
    renderSearchResults(results, query);
}

function renderSearchResults(results, query) {
    const contentArea = document.getElementById('content-area');
    const contentTitle = document.getElementById('content-title');
    if (!contentArea || !contentTitle) return;

    // Deselect any active navigation item
    document.querySelectorAll('#navigation a').forEach(link => {
        link.classList.remove('primary-bg', 'text-white');
        link.style.backgroundColor = '';
    });
    activeKey = null;

    contentTitle.textContent = `نتایج جستجو برای: "${query}"`;
    contentArea.innerHTML = '';

    if (results.length === 0) {
        contentArea.innerHTML = `<p>هیچ نتیجه‌ای برای جستجوی شما یافت نشد.</p>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    const uniqueResults = new Map();

    // Ensure we only show one editable field per unique text value found
    results.forEach(result => {
        if (!uniqueResults.has(result.value)) {
            uniqueResults.set(result.value, result);
        }
    });

    uniqueResults.forEach(result => {
        const resultCard = document.createElement('div');
        resultCard.className = 'bg-card p-4 mb-4 border border-color rounded-lg fade-in';

        const pathElement = document.createElement('p');
        pathElement.className = 'text-sm text-gray-400 mb-2';
        const readablePath = result.path
            .replace(/\[\d+\]/g, '') // remove array indices from path
            .replace(/\./g, ' > ')
            .replace(/_/g, ' ');
        pathElement.textContent = readablePath;
        resultCard.appendChild(pathElement);

        const itemContainer = document.createElement('div');
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'flex items-start gap-2 group';

        const textElement = document.createElement('span');
        textElement.setAttribute('contenteditable', 'true');
        textElement.className = 'flex-grow p-1 rounded-md focus:outline-none focus:ring-2 focus-ring';

        const regex = new RegExp(query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
        textElement.innerHTML = result.value.replace(regex, (match) => `<mark>${match}</mark>`);

        textElement.onblur = (e) => {
            const oldValue = getNestedValue(currentData, result.path);
            const newValue = e.target.innerText; // innerText strips out <mark> tags
            if (oldValue !== newValue) {
                updateData(result.path, newValue);
                showNotification('متن با موفقیت ویرایش شد.', 'success');
            }
        };

        const noteButton = document.createElement('button');
        noteButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-50 group-hover:opacity-100 transition-opacity" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>`;
        noteButton.title = 'افزودن یادداشت';
        noteButton.className = 'mt-1 text-gray-400 hover:text-white';
        noteButton.onclick = () => showInlineNoteEditor(itemContainer, result.path);
        
        contentWrapper.appendChild(textElement);
        contentWrapper.appendChild(noteButton);
        itemContainer.appendChild(contentWrapper);

        // Check for and render existing notes
        const notesPath = `${result.path}_notes`;
        const notes = getNestedValue(currentData, notesPath);
        if (Array.isArray(notes)) {
            notes.forEach((note, index) => {
                renderNoteDisplay(itemContainer, result.path, note, index);
            });
        }

        resultCard.appendChild(itemContainer);
        fragment.appendChild(resultCard);
    });

    contentArea.appendChild(fragment);
}


function clearSearchAndRestoreView() {
    const contentArea = document.getElementById('content-area');
    const contentTitle = document.getElementById('content-title');
    if (!contentArea || !contentTitle) return;

    if (activeKey) {
        renderContent(activeKey, currentData[activeKey]);
        document.querySelectorAll('#navigation a').forEach(link => {
            if (link.textContent === activeKey.replace(/_/g, ' ')) {
                link.classList.add('text-white');
                link.style.backgroundColor = '#38bdf8';
            }
        });
    } else {
        contentTitle.textContent = 'انتخاب کنید';
        contentArea.innerHTML = '<p>لطفا یک بخش را از منوی سمت راست انتخاب کنید.</p>';
    }
}