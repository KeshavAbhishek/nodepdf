document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('pdf_files');
    const dropArea = document.getElementById('drop-area');
    const filesContainer = document.getElementById('files-container');
    const emptyState = document.getElementById('empty-state');
    const mergeBtn = document.getElementById('merge-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressFill = document.getElementById('progress-fill');
    const pdfForm = document.getElementById('pdf-form');
    const fileList = [];

    const MAX_SIZE_MB_PER_FILE = 50;
    // --- START: NEW ---
    // This should match the `client_max_body_size` in your Nginx config.
    const NGINX_TOTAL_LIMIT_MB = 100;
    // --- END: NEW ---

    // Theme Toggle
    const themeCheckbox = document.getElementById('theme-checkbox');
    const darkThemeStyle = document.getElementById('dark-theme-style');

    const applyTheme = (isDarkMode) => {
        darkThemeStyle.disabled = !isDarkMode;
        document.body.classList.toggle('dark-mode', isDarkMode);
        themeCheckbox.checked = isDarkMode;
    };

    themeCheckbox.addEventListener('change', () => {
        const isDarkMode = themeCheckbox.checked;
        applyTheme(isDarkMode);
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    });

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        applyTheme(savedTheme === 'dark');
    } else {
        const hour = new Date().getHours();
        const isNight = hour >= 18 || hour < 6;
        applyTheme(isNight);
        localStorage.setItem('theme', isNight ? 'dark' : 'light');
    }

    // Handle drag-drop
    fileInput.addEventListener('click', (e) => e.stopPropagation());
    dropArea.addEventListener('click', () => fileInput.click());
    dropArea.addEventListener('dragover', e => {
        e.preventDefault();
        dropArea.classList.add('dragover');
    });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
    dropArea.addEventListener('drop', e => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => handleFiles(fileInput.files));

    // Handle files
    function handleFiles(files) {
        [...files].forEach(file => {
            if (file.type !== 'application/pdf') {
                Toastify({
                    text: `${file.name} is not a valid PDF.`,
                    duration: 3000, gravity: "top", position: "right", backgroundColor: "#ef4444",
                }).showToast();
                return;
            }

            if (file.size > MAX_SIZE_MB_PER_FILE * 1024 * 1024) {
                Toastify({
                    text: `${file.name} exceeds ${MAX_SIZE_MB_PER_FILE}MB size limit.`,
                    duration: 3000, gravity: "top", position: "right", backgroundColor: "#f59e0b",
                }).showToast();
                return;
            }

            fileList.push(file);
            renderFileCards();
        });
    }

    // Render file cards
    function renderFileCards() {
        filesContainer.innerHTML = '';
        if (fileList.length === 0) {
            emptyState.style.display = 'flex';
            mergeBtn.disabled = true;
            return;
        }

        emptyState.style.display = 'none';
        mergeBtn.disabled = false;

        fileList.forEach((file, index) => {
            const card = document.createElement('div');
            card.className = 'file-card';
            card.setAttribute('data-id', index);
            card.innerHTML = `
                <div class="file-info-wrapper">
                    <div class="file-icon"><i class="fas fa-file-pdf"></i></div>
                    <div class="file-info">
                        <div class="file-name">${file.name}</div>
                        <div class="file-size">${(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                    </div>
                </div>
                <div class="file-actions">
                    <div class="reorder-controls">
                        <button class="reorder-btn up-btn" title="Move Up"><i class="fas fa-chevron-up"></i></button>
                        <button class="reorder-btn down-btn" title="Move Down"><i class="fas fa-chevron-down"></i></button>
                    </div>
                    <button class="action-btn view-btn btn-view" title="Preview"><i class="fas fa-eye"></i></button>
                    <button class="action-btn remove-btn btn-delete" title="Remove"><i class="fas fa-trash-alt"></i></button>
                </div>`;

            card.querySelector('.btn-delete').addEventListener('click', () => {
                fileList.splice(index, 1);
                renderFileCards();
            });

            card.querySelector('.btn-view').addEventListener('click', () => {
                const url = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }));
                window.open(url, '_blank');
            });

            const upBtn = card.querySelector('.up-btn');
            const downBtn = card.querySelector('.down-btn');

            upBtn.addEventListener('click', () => {
                if (index > 0) { [fileList[index], fileList[index - 1]] = [fileList[index - 1], fileList[index]]; renderFileCards(); }
            });
            downBtn.addEventListener('click', () => {
                if (index < fileList.length - 1) { [fileList[index], fileList[index + 1]] = [fileList[index + 1], fileList[index]]; renderFileCards(); }
            });

            if (index === 0) upBtn.disabled = true;
            if (index === fileList.length - 1) downBtn.disabled = true;

            filesContainer.appendChild(card);
        });
    }

    // Handle form submission
    pdfForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (fileList.length === 0) return;

        // --- START: NEW CODE BLOCK ---
        // Calculate the total size of all files to be uploaded.
        const totalUploadSize = fileList.reduce((acc, file) => acc + file.size, 0);
        const limitInBytes = NGINX_TOTAL_LIMIT_MB * 1024 * 1024;

        // Check if the total size exceeds our Nginx limit.
        if (totalUploadSize > limitInBytes) {
            Toastify({
                text: `Total upload size exceeds the server limit of ${NGINX_TOTAL_LIMIT_MB}MB. Please remove some files.`,
                duration: 5000, // Show for 5 seconds
                gravity: "top",
                position: "center",
                style: {
                    background: "linear-gradient(to right, #ff5f6d, #ffc371)",
                    fontSize: "1rem",
                    borderRadius: "8px",
                    padding: "16px",
                }
            }).showToast();
            return; // Stop the function here to prevent the upload.
        }
        // --- END: NEW CODE BLOCK ---

        const formData = new FormData();
        fileList.forEach(file => formData.append('files', file));

        loadingOverlay.style.display = 'flex';
        progressFill.style.width = '0%';

        try {
            const res = await fetch('/upload', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                // Handle specific errors from the server if possible
                const errorData = await res.json().catch(() => null);
                throw new Error(errorData?.message || 'Merge failed on the server.');
            }

            const result = await res.json();
            progressFill.style.width = '100%';
            setTimeout(() => {
                showDownloadSection(result.mergedFile);
                loadingOverlay.style.display = 'none';
            }, 1000);

        } catch (err)
        {
            loadingOverlay.style.display = 'none';
            // Use Toastify for errors instead of the ugly default alert
            Toastify({
                text: err.message || 'An unknown error occurred.',
                duration: 4000, gravity: "top", position: "right", backgroundColor: "#ef4444",
            }).showToast();
            console.error(err);
        }
    });

    // Show download buttons
    function showDownloadSection(mergedFile) {
        filesContainer.innerHTML = `
            <div class="download-section">
                <div class="success-icon"><i class="fas fa-check-circle"></i></div>
                <h3>Your File is Ready!</h3>
                <p>Your PDFs have been successfully merged.</p>
                <div class="download-buttons">
                    <a href="${mergedFile.downloadLink}" class="action-btn download-btn" target="_blank" download>
                        <i class="fas fa-download"></i>
                        <span>Download Merged PDF</span>
                    </a>
                    <button type="button" class="action-btn action-btn-secondary" onclick="location.reload()">
                        <i class="fas fa-plus-circle"></i>
                        <span>Merge More Files</span>
                    </button>
                </div>
            </div>`;
    }
});