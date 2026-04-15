require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const pdfDirectory = path.join(__dirname, 'generated-pdfs');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'pdfs';
const supabaseBucketPublic = process.env.SUPABASE_BUCKET_PUBLIC !== 'false';
const signedUrlExpiresIn = Number(process.env.SUPABASE_SIGNED_URL_EXPIRES_IN || 3600);
const useSupabaseStorage = Boolean(supabaseUrl && supabaseServiceRoleKey);
const supabase = useSupabaseStorage
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

if (!fs.existsSync(pdfDirectory)) {
  fs.mkdirSync(pdfDirectory, { recursive: true });
}

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use('/pdfs', express.static(pdfDirectory));

let browser = null;

async function storePdf(fileName, pdfBuffer, req) {
  if (supabase) {
    const storagePath = `generated/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from(supabaseBucket)
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    if (supabaseBucketPublic) {
      const { data } = supabase.storage.from(supabaseBucket).getPublicUrl(storagePath);
      return {
        fileName,
        storage: 'supabase',
        path: storagePath,
        url: data.publicUrl
      };
    }

    const { data, error: signedUrlError } = await supabase.storage
      .from(supabaseBucket)
      .createSignedUrl(storagePath, signedUrlExpiresIn);

    if (signedUrlError) {
      throw signedUrlError;
    }

    return {
      fileName,
      storage: 'supabase',
      path: storagePath,
      url: data.signedUrl,
      expiresIn: signedUrlExpiresIn
    };
  }

  const filePath = path.join(pdfDirectory, fileName);
  fs.writeFileSync(filePath, pdfBuffer);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return {
    fileName,
    storage: 'local',
    path: filePath,
    url: `${baseUrl}/pdfs/${fileName}`
  };
}

// Initialize browser
async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });
  }
  return browser;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'HTML to PDF API is running' });
});

// Main HTML to PDF endpoint
app.post('/convert', async (req, res) => {
  try {
    const { html, options = {} } = req.body;

    if (!html) {
      return res.status(400).json({ error: 'HTML content is required' });
    }

    // Initialize browser
    const browser = await initBrowser();
    const page = await browser.newPage();

    // Default PDF options
    const pdfOptions = {
      format: 'A4',
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      },
      ...options
    };

    // Set HTML content
    await page.setContent(html, { waitUntil: 'networkidle2' });

    // Generate PDF
    const pdfBuffer = Buffer.from(await page.pdf(pdfOptions));

    await page.close();

    const fileName = `document-${Date.now()}-${crypto.randomUUID()}.pdf`;
    const storedPdf = await storePdf(fileName, pdfBuffer, req);

    res.json({
      success: true,
      fileName: storedPdf.fileName,
      storage: storedPdf.storage,
      path: storedPdf.path,
      url: storedPdf.url,
      expiresIn: storedPdf.expiresIn || null
    });

  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    res.status(500).json({
      error: 'Failed to convert HTML to PDF',
      message: error.message
    });
  }
});

// Endpoint to get PDF as base64
app.post('/convert-base64', async (req, res) => {
  try {
    const { html, options = {} } = req.body;

    if (!html) {
      return res.status(400).json({ error: 'HTML content is required' });
    }

    const browser = await initBrowser();
    const page = await browser.newPage();

    const pdfOptions = {
      format: 'A4',
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      },
      ...options
    };

    await page.setContent(html, { waitUntil: 'networkidle2' });
    const pdfBuffer = Buffer.from(await page.pdf(pdfOptions));
    await page.close();

    const base64 = pdfBuffer.toString('base64');
    res.json({
      success: true,
      pdf: base64,
      mimeType: 'application/pdf'
    });

  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    res.status(500).json({
      error: 'Failed to convert HTML to PDF',
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`HTML to PDF API running on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /health                 - Health check`);
  console.log(`  POST /convert                - Return PDF URL`);
  console.log(`  POST /convert-base64         - Get PDF as base64`);
  console.log(`  Storage mode: ${useSupabaseStorage ? `Supabase (${supabaseBucket})` : 'Local fallback'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing browser...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
