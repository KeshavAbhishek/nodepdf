require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { PDFDocument } = require('pdf-lib');
const cron = require('node-cron');

const app = express();
const PORT = 3000;

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oauth2Client });

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
    fileFilter: (req, file, cb) => {
        if (mime.lookup(file.originalname) !== 'application/pdf') {
            return cb(new Error('Only PDFs allowed'));
        }
        cb(null, true);
    },
});

app.use(express.static('public'));

app.post('/upload', upload.array('files'), async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
        return res.status(400).json({ message: 'No PDF files uploaded.' });
    }

    const timestamp = Date.now().toString();
    let folderId;

    try {
        const folder = await drive.files.create({
            requestBody: {
                name: timestamp,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [process.env.PARENT_FOLDER_ID],
            },
            fields: 'id',
        });
        folderId = folder.data.id;
    } catch (err) {
        return res.status(500).json({ message: 'Failed to create folder.' });
    }

    const mergedPdf = await PDFDocument.create();
    const uploadedFiles = [];

    for (const file of files) {
        const filePath = file.path;
        const fileName = file.originalname;

        try {
            const pdfBytes = fs.readFileSync(filePath);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));

            const upload = await drive.files.create({
                requestBody: {
                    name: fileName,
                    mimeType: 'application/pdf',
                    parents: [folderId],
                },
                media: {
                    mimeType: 'application/pdf',
                    body: fs.createReadStream(filePath),
                },
                fields: 'id',
            });

            const fileId = upload.data.id;

            await drive.permissions.create({
                fileId,
                requestBody: { role: 'reader', type: 'anyone' },
            });

            const links = await drive.files.get({
                fileId,
                fields: 'webViewLink, webContentLink',
            });

            uploadedFiles.push({
                name: fileName,
                viewLink: links.data.webViewLink,
                downloadLink: links.data.webContentLink,
            });

            fs.unlinkSync(filePath);
        } catch (err) {
            console.error('File error:', err.message);
            fs.unlinkSync(file.path);
        }
    }

    if (mergedPdf.getPageCount() === 0) {
        return res.status(400).json({ message: 'No valid PDFs to merge.' });
    }

    const mergedPath = path.join(__dirname, 'uploads', `${timestamp}_merged.pdf`);
    fs.writeFileSync(mergedPath, await mergedPdf.save());

    let mergedFile = {};
    try {
        const mergeRes = await drive.files.create({
            requestBody: {
                name: `${timestamp}_merged.pdf`,
                mimeType: 'application/pdf',
                parents: [folderId],
            },
            media: {
                mimeType: 'application/pdf',
                body: fs.createReadStream(mergedPath),
            },
            fields: 'id',
        });

        const mergedId = mergeRes.data.id;

        await drive.permissions.create({
            fileId: mergedId,
            requestBody: { role: 'reader', type: 'anyone' },
        });

        const links = await drive.files.get({
            fileId: mergedId,
            fields: 'webViewLink, webContentLink',
        });

        mergedFile = {
            name: `${timestamp}_merged.pdf`,
            viewLink: links.data.webViewLink,
            downloadLink: links.data.webContentLink,
        };

        fs.unlinkSync(mergedPath);
    } catch (err) {
        console.error('Error uploading merged PDF:', err.message);
    }

    res.json({
        folderName: timestamp,
        folderId,
        uploadedFiles,
        mergedFile,
    });
});

// 🧹 Scheduled cleanup: deletes folders older than 1 hour
cron.schedule('0 * * * *', async () => {

    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    try {
        const folderList = await drive.files.list({
            q: `'${process.env.PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
            fields: 'files(id, name, createdTime)',
        });

        for (const folder of folderList.data.files) {
            const folderTime = new Date(folder.createdTime).getTime();
            if (folderTime < oneHourAgo) {
                await drive.files.delete({ fileId: folder.id });
            }
        }
    } catch (err) {
        console.error('CRON cleanup error:', err.message);
    }
});

app.listen(PORT, () => {});