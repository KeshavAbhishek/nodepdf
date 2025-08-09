const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = 3000;

// --- Directory Setup ---
// Ensure the main 'uploads' and the 'mergedPDF' directories exist.
const uploadsDir = path.join(__dirname, 'uploads');
const mergedDir = path.join(__dirname, 'uploads', 'mergedPDF');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(mergedDir)) {
    fs.mkdirSync(mergedDir, { recursive: true });
}

// --- Multer Configuration ---
// Configure multer to save files into a temporary, unique directory for each request.
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Create a unique directory for this upload session based on the current time
        const timestamp = Date.now().toString();
        // If the directory doesn't exist for this request, create it.
        if (!req.uploadDir) {
            req.uploadDir = path.join(uploadsDir, timestamp);
            fs.mkdirSync(req.uploadDir, { recursive: true });
        }
        cb(null, req.uploadDir);
    },
    filename: (req, file, cb) => {
        // Use the original filename for the uploaded file
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files are allowed!'), false);
        }
        cb(null, true);
    },
});

// --- Middleware ---
// Serve the static files from the 'public' directory (like index.html, app.js, etc.)
app.use(express.static('public'));
// Create a static route to serve the final merged PDFs for download
app.use('/merged', express.static(mergedDir));

// --- API Route ---
app.post('/upload', upload.array('files'), async (req, res) => {
    // req.uploadDir is the temporary directory created by multer
    const tempUploadDir = req.uploadDir;

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No PDF files were uploaded.' });
    }

    try {
        const mergedPdf = await PDFDocument.create();

        // The files are uploaded in the order they were selected.
        for (const file of req.files) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        if (mergedPdf.getPageCount() === 0) {
            return res.status(400).json({ message: 'Could not merge the provided PDFs.' });
        }

        const mergedPdfBytes = await mergedPdf.save();
        const mergedFileName = `${Date.now()}_merged.pdf`;
        const finalOutputPath = path.join(mergedDir, mergedFileName);

        // Save the final merged PDF to the 'uploads/mergedPDF' directory
        fs.writeFileSync(finalOutputPath, mergedPdfBytes);

        // Create a public-facing download link
        const downloadLink = `/merged/${mergedFileName}`;

        // Send the download link back to the frontend
        res.json({
            mergedFile: {
                downloadLink: downloadLink
            }
        });

    } catch (err) {
        console.error('Error during PDF merging process:', err);
        res.status(500).json({ message: 'An error occurred while merging the PDFs.' });
    } finally {
        // --- Cleanup ---
        // Always delete the temporary upload directory and its contents
        if (tempUploadDir) {
            fs.rm(tempUploadDir, { recursive: true, force: true }, (err) => {
                // if (err) {
                //     console.error(`Error deleting temporary directory ${tempUploadDir}:`, err);
                // }
            });
        }
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});